"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { DocumentFileValidationError, validateDocumentFile } from "@/server/documents/file-validation";
import { createDocumentStorageKey, removeDocumentFile, writeDocumentFile } from "@/server/documents/storage";
import {
  completeVisitWithClosingDocument,
  createAssignedVisitEvidence,
  createVisit,
  createVisitSeries,
  rescheduleVisit,
  startAssignedMasterVisit,
  updateVisit,
  VisitDuplicateError,
  VisitClosingDocumentRequiredError,
  VisitImmutableError,
  VisitNotFoundError,
  VisitReferenceError,
  VisitRescheduleReasonRequiredError,
  VisitScheduleConflictError,
  VisitScheduleUnchangedError,
  VisitStateTransitionError,
  VisitVersionConflictError,
  visitCompletionExists,
  visitEvidenceExists,
} from "@/server/visits/repository";
import { completeVisitSchema, createVisitSchema, createVisitSeriesSchema, rescheduleVisitSchema, startVisitSchema, updateVisitSchema, uploadVisitEvidenceSchema } from "@/server/visits/schemas";

export type CreateVisitState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; visitId: string | null };
export type CreateVisitSeriesState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; seriesId: string | null; visitCount: number | null };
export type UpdateVisitState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; version: number | null };
export type CompleteVisitState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; documentId: string | null; refreshRequired?: true };
export type StartVisitState = { status: "idle" | "success" | "error"; message: string | null; version: number | null };
export type VisitEvidenceState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; refreshRequired?: true };
export type RescheduleVisitResult = {
  status: "success" | "error";
  message: string;
  version: number | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
};

const previewMessage = "Предпросмотр не записывает выезды. Для сохранения включите рабочий режим и PostgreSQL.";

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}

export async function createVisitAction(_previous: CreateVisitState, formData: FormData): Promise<CreateVisitState> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, fieldErrors: {}, visitId: null };
  const member = await requireSession();
  const parsed = createVisitSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    orderId: formData.get("orderId"),
    localDate: formData.get("localDate"),
    localTime: formData.get("localTime"),
    durationMinutes: formData.get("durationMinutes"),
    assignedMasterId: formData.get("assignedMasterId"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте дату, время и длительность выезда.", fieldErrors: fieldErrors(parsed.error), visitId: null };
  try {
    const visitId = await createVisit(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { status: "success", message: "Выезд создан.", fieldErrors: {}, visitId };
  } catch (error) {
    if (error instanceof VisitDuplicateError) return { status: "error", message: "У этого заказа уже есть выезд на выбранную дату и время.", fieldErrors: { localTime: ["Выберите другое время"] }, visitId: null };
    if (error instanceof VisitScheduleConflictError) return { status: "error", message: "У мастера уже есть другой выезд в это время.", fieldErrors: { assignedMasterId: ["Выберите другого мастера или время"] }, visitId: null };
    if (error instanceof VisitReferenceError) return { status: "error", message: error.field === "order" ? "Заказ больше не существует или недоступен." : "Мастер больше недоступен.", fieldErrors: {}, visitId: null };
    logUnexpected("service_visits.create", member.memberId, error);
    return { status: "error", message: "Не удалось создать выезд. Изменения не сохранены.", fieldErrors: {}, visitId: null };
  }
}

export async function completeVisitAction(_previous: CompleteVisitState, formData: FormData): Promise<CompleteVisitState> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, fieldErrors: {}, documentId: null };
  const member = await requireSession();
  const parsed = completeVisitSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    visitId: formData.get("visitId"),
    expectedVersion: formData.get("expectedVersion"),
    actTitle: formData.get("actTitle"),
    completionNotes: formData.get("completionNotes"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте название акта и результат работ.", fieldErrors: fieldErrors(parsed.error), documentId: null };
  const uploadedFile = formData.get("file");
  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
    return { status: "error", message: "Приложите подписанный акт.", fieldErrors: { file: ["Закрывающий документ обязателен"] }, documentId: null };
  }

  let storageKey: string | null = null;
  let fileWritten = false;
  let completedDocumentId: string | null = null;
  try {
    if (await visitCompletionExists(member, parsed.data.visitId, parsed.data.idempotencyKey)) {
      return { status: "success", message: "Выезд уже завершён, акт сохранён.", fieldErrors: {}, documentId: parsed.data.idempotencyKey };
    }
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const file = validateDocumentFile({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
    if (file.extension === "docx" || file.extension === "xlsx") {
      return { status: "error", message: "Для закрытия принимаются PDF или фотография подписанного акта.", fieldErrors: { file: ["Выберите PDF, JPG, PNG или WebP"] }, documentId: null };
    }
    storageKey = createDocumentStorageKey(member.organizationId, parsed.data.idempotencyKey, file.extension);
    await writeDocumentFile(storageKey, buffer);
    fileWritten = true;
    const completed = await completeVisitWithClosingDocument(member, { ...parsed.data, ...file, storageKey });
    completedDocumentId = completed.documentId;
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    revalidatePath("/documents");
    revalidatePath("/my-visits");
    revalidatePath(`/orders/${completed.orderId}`);
    return { status: "success", message: "Выезд завершён, акт добавлен в архив.", fieldErrors: {}, documentId: completed.documentId };
  } catch (error) {
    if (completedDocumentId) {
      logUnexpected("service_visits.complete.revalidate", member.memberId, error);
      return { status: "success", refreshRequired: true, message: "Выезд завершён, акт сохранён, но страницу не удалось обновить. Обновите её вручную.", fieldErrors: {}, documentId: completedDocumentId };
    }
    if (error instanceof DocumentFileValidationError) return { status: "error", message: error.message, fieldErrors: { file: [error.message] }, documentId: null };
    if (errorCode(error) === "EEXIST") {
      if (await visitCompletionExists(member, parsed.data.visitId, parsed.data.idempotencyKey)) {
        return { status: "success", message: "Выезд уже завершён, акт сохранён.", fieldErrors: {}, documentId: parsed.data.idempotencyKey };
      }
      return { status: "error", message: "Эта загрузка уже обрабатывается. Закройте окно и повторите с новым файлом.", fieldErrors: {}, documentId: null };
    }
    const rejected = error instanceof VisitVersionConflictError || error instanceof VisitNotFoundError
      || error instanceof VisitImmutableError || error instanceof AuthorizationError;
    if (storageKey && fileWritten && rejected) {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { logUnexpected("service_visits.complete.cleanup", member.memberId, cleanupError); }
    }
    if (error instanceof VisitVersionConflictError) return { status: "error", message: "Выезд уже изменил другой сотрудник. Обновите страницу и повторите.", fieldErrors: {}, documentId: null };
    if (error instanceof VisitNotFoundError) return { status: "error", message: "Выезд больше не существует или недоступен.", fieldErrors: {}, documentId: null };
    if (error instanceof VisitImmutableError) return { status: "error", message: "Отменённый или уже завершённый выезд закрыть повторно нельзя.", fieldErrors: {}, documentId: null };
    if (error instanceof AuthorizationError) return { status: "error", message: "Этот выезд не назначен вашей учётной записи.", fieldErrors: {}, documentId: null };
    logUnexpected("service_visits.complete", member.memberId, error);
    return { status: "error", message: "Не удалось подтвердить завершение выезда. Обновите карточку и проверьте акт перед повторной отправкой.", fieldErrors: {}, documentId: null };
  }
}

export async function startAssignedVisitAction(_previous: StartVisitState, formData: FormData): Promise<StartVisitState> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, version: null };
  const member = await requireSession();
  const parsed = startVisitSchema.safeParse({ visitId: formData.get("visitId"), expectedVersion: formData.get("expectedVersion") });
  if (!parsed.success) return { status: "error", message: "Карточка выезда устарела. Обновите страницу.", version: null };
  try {
    const result = await startAssignedMasterVisit(member, parsed.data);
    revalidatePath("/my-visits");
    revalidatePath("/calendar");
    if (result.orderId) revalidatePath(`/orders/${result.orderId}`);
    return { status: "success", message: "Работа начата.", version: result.version };
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof VisitNotFoundError) return { status: "error", message: "Этот выезд не назначен вашей учётной записи.", version: null };
    if (error instanceof VisitVersionConflictError) return { status: "error", message: "Выезд уже изменён. Обновите страницу.", version: null };
    if (error instanceof VisitStateTransitionError) return { status: "error", message: "Выезд уже завершён, отменён или не может быть начат.", version: null };
    logUnexpected("service_visits.start", member.memberId, error);
    return { status: "error", message: "Не удалось начать работу. Статус не изменён.", version: null };
  }
}

export async function uploadAssignedVisitEvidenceAction(
  _previous: VisitEvidenceState,
  formData: FormData,
): Promise<VisitEvidenceState> {
  if (getAuthMode() === "preview") {
    return { status: "error", message: previewMessage, fieldErrors: {} };
  }
  const member = await requireSession();
  const parsed = uploadVisitEvidenceSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    visitId: formData.get("visitId"),
    kind: formData.get("kind"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Проверьте тип и описание материала.", fieldErrors: fieldErrors(parsed.error) };
  }
  const uploadedFile = formData.get("file");
  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
    return { status: "error", message: "Выберите фотографию.", fieldErrors: { file: ["Фотография обязательна"] } };
  }

  let storageKey: string | null = null;
  let fileWritten = false;
  let committed = false;
  try {
    if (await visitEvidenceExists(member, parsed.data.idempotencyKey)) {
      return { status: "success", message: "Этот материал уже сохранён.", fieldErrors: {} };
    }
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const file = validateDocumentFile({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
    if (file.extension !== "jpg" && file.extension !== "png" && file.extension !== "webp") {
      return { status: "error", message: "Загрузите фотографию в JPG, PNG или WebP.", fieldErrors: { file: ["Поддерживаются JPG, PNG и WebP"] } };
    }
    storageKey = createDocumentStorageKey(member.organizationId, parsed.data.idempotencyKey, file.extension);
    await writeDocumentFile(storageKey, buffer);
    fileWritten = true;
    const created = await createAssignedVisitEvidence(member, {
      ...parsed.data,
      ...file,
      extension: file.extension,
      storageKey,
    });
    committed = true;
    revalidatePath("/documents");
    revalidatePath("/my-visits");
    revalidatePath(`/orders/${created.orderId}`);
    return { status: "success", message: "Материал сохранён в документах заказа.", fieldErrors: {} };
  } catch (error) {
    if (committed) {
      logUnexpected("service_visits.evidence.revalidate", member.memberId, error);
      return { status: "success", refreshRequired: true, message: "Материал сохранён, но страницу не удалось обновить. Обновите её вручную.", fieldErrors: {} };
    }
    if (error instanceof DocumentFileValidationError) {
      return { status: "error", message: error.message, fieldErrors: { file: [error.message] } };
    }
    if (errorCode(error) === "EEXIST") {
      if (await visitEvidenceExists(member, parsed.data.idempotencyKey)) {
        return { status: "success", message: "Этот материал уже сохранён.", fieldErrors: {} };
      }
      return { status: "error", message: "Эта загрузка ещё обрабатывается. Подождите и повторите.", fieldErrors: {} };
    }
    const rejected = error instanceof AuthorizationError || error instanceof VisitNotFoundError || error instanceof VisitImmutableError;
    if (storageKey && fileWritten && rejected) {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { logUnexpected("service_visits.evidence.cleanup", member.memberId, cleanupError); }
    }
    if (error instanceof AuthorizationError || error instanceof VisitNotFoundError) {
      return { status: "error", message: "Этот выезд не назначен вашей учётной записи.", fieldErrors: {} };
    }
    if (error instanceof VisitImmutableError) {
      return { status: "error", message: "К отменённому выезду нельзя добавлять материалы.", fieldErrors: {} };
    }
    logUnexpected("service_visits.evidence.create", member.memberId, error);
    return { status: "error", message: "Не удалось подтвердить сохранение материала. Обновите документы заказа и проверьте результат перед повторной отправкой.", fieldErrors: {} };
  }
}

export async function createVisitSeriesAction(_previous: CreateVisitSeriesState, formData: FormData): Promise<CreateVisitSeriesState> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, fieldErrors: {}, seriesId: null, visitCount: null };
  const member = await requireSession();
  const parsed = createVisitSeriesSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    orderId: formData.get("orderId"),
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
    localTime: formData.get("localTime"),
    durationMinutes: formData.get("durationMinutes"),
    frequencyUnit: formData.get("frequencyUnit"),
    frequencyInterval: formData.get("frequencyInterval"),
    assignedMasterId: formData.get("assignedMasterId"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте период и правило повторения.", fieldErrors: fieldErrors(parsed.error), seriesId: null, visitCount: null };
  try {
    const result = await createVisitSeries(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { status: "success", message: `Создано выездов: ${result.visitCount}.`, fieldErrors: {}, seriesId: result.seriesId, visitCount: result.visitCount };
  } catch (error) {
    if (error instanceof VisitDuplicateError) return { status: "error", message: "Одна из дат уже занята другим выездом этого заказа. Серия не создана.", fieldErrors: {}, seriesId: null, visitCount: null };
    if (error instanceof VisitScheduleConflictError) return { status: "error", message: "Одна из дат пересекается с расписанием мастера. Серия не создана целиком.", fieldErrors: { assignedMasterId: ["Выберите другого мастера или измените расписание"] }, seriesId: null, visitCount: null };
    if (error instanceof VisitReferenceError) return { status: "error", message: error.field === "order" ? "Заказ больше не существует или недоступен." : "Мастер больше недоступен.", fieldErrors: {}, seriesId: null, visitCount: null };
    logUnexpected("service_visit_series.create", member.memberId, error);
    return { status: "error", message: "Не удалось создать серию. Ни один выезд не был сохранён.", fieldErrors: {}, seriesId: null, visitCount: null };
  }
}

export async function updateVisitAction(_previous: UpdateVisitState, formData: FormData): Promise<UpdateVisitState> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, fieldErrors: {}, version: null };
  const member = await requireSession();
  const parsed = updateVisitSchema.safeParse({
    visitId: formData.get("visitId"),
    expectedVersion: formData.get("expectedVersion"),
    localDate: formData.get("localDate"),
    localTime: formData.get("localTime"),
    durationMinutes: formData.get("durationMinutes"),
    status: formData.get("status"),
    assignedMasterId: formData.get("assignedMasterId"),
    cancellationReason: formData.get("cancellationReason"),
    rescheduleReason: formData.get("rescheduleReason"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте параметры выезда.", fieldErrors: fieldErrors(parsed.error), version: null };
  try {
    const version = await updateVisit(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    revalidatePath(`/orders/${formData.get("orderId") ?? ""}`);
    return { status: "success", message: "Изменения сохранены.", fieldErrors: {}, version };
  } catch (error) {
    if (error instanceof VisitClosingDocumentRequiredError) return { status: "error", message: "Чтобы завершить выезд, загрузите закрывающий акт через отдельную кнопку.", fieldErrors: { status: ["Требуется закрывающий акт"] }, version: null };
    if (error instanceof VisitImmutableError) return { status: "error", message: "Завершённый выезд изменять нельзя.", fieldErrors: {}, version: null };
    if (error instanceof VisitVersionConflictError) return { status: "error", message: "Выезд уже изменил другой сотрудник. Обновите страницу перед повтором.", fieldErrors: {}, version: null };
    if (error instanceof VisitNotFoundError) return { status: "error", message: "Выезд больше не существует или недоступен.", fieldErrors: {}, version: null };
    if (error instanceof VisitDuplicateError) return { status: "error", message: "У этого заказа уже есть выезд на выбранную дату и время.", fieldErrors: { localTime: ["Выберите другое время"] }, version: null };
    if (error instanceof VisitScheduleConflictError) return { status: "error", message: "У мастера уже есть другой выезд в это время.", fieldErrors: { assignedMasterId: ["Выберите другого мастера или время"] }, version: null };
    if (error instanceof VisitRescheduleReasonRequiredError) return { status: "error", message: "Чтобы изменить дату, время или длительность, укажите причину переноса.", fieldErrors: { rescheduleReason: ["Укажите причину переноса"] }, version: null };
    if (error instanceof VisitReferenceError) return { status: "error", message: "Мастер больше недоступен.", fieldErrors: {}, version: null };
    logUnexpected("service_visits.update", member.memberId, error);
    return { status: "error", message: "Не удалось сохранить выезд.", fieldErrors: {}, version: null };
  }
}

export async function rescheduleVisitAction(visitId: string, expectedVersion: number, localDate: string, localTime: string, rescheduleReason: string): Promise<RescheduleVisitResult> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, version: null, scheduledStartAt: null, scheduledEndAt: null };
  const member = await requireSession();
  const parsed = rescheduleVisitSchema.safeParse({ visitId, expectedVersion, localDate, localTime, rescheduleReason });
  if (!parsed.success) return { status: "error", message: "Проверьте дату, время и причину переноса.", version: null, scheduledStartAt: null, scheduledEndAt: null };
  try {
    const result = await rescheduleVisit(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    if (result.orderId) revalidatePath(`/orders/${result.orderId}`);
    return { status: "success", message: "Выезд перенесён.", version: result.version, scheduledStartAt: result.scheduledStartAt, scheduledEndAt: result.scheduledEndAt };
  } catch (error) {
    if (error instanceof VisitVersionConflictError) return { status: "error", message: "Выезд уже изменил другой сотрудник. Обновите календарь и повторите.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    if (error instanceof VisitNotFoundError) return { status: "error", message: "Выезд больше не существует или недоступен.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    if (error instanceof VisitImmutableError) return { status: "error", message: "Завершённый или отменённый выезд переносить нельзя.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    if (error instanceof VisitScheduleUnchangedError) return { status: "error", message: "Новая дата и время совпадают с текущими.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    if (error instanceof VisitDuplicateError) return { status: "error", message: "У этого заказа уже есть выезд на выбранную дату и время.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    if (error instanceof VisitScheduleConflictError) return { status: "error", message: "У назначенного мастера уже есть выезд в это время.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    logUnexpected("service_visits.reschedule", member.memberId, error);
    return { status: "error", message: "Не удалось перенести выезд. Расписание не изменено.", version: null, scheduledStartAt: null, scheduledEndAt: null };
  }
}
