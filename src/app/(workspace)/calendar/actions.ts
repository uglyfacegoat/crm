"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  createVisit,
  createVisitSeries,
  rescheduleVisit,
  updateVisit,
  VisitDuplicateError,
  VisitImmutableError,
  VisitNotFoundError,
  VisitReferenceError,
  VisitScheduleConflictError,
  VisitVersionConflictError,
} from "@/server/visits/repository";
import { createVisitSchema, createVisitSeriesSchema, rescheduleVisitSchema, updateVisitSchema } from "@/server/visits/schemas";

export type CreateVisitState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; visitId: string | null };
export type CreateVisitSeriesState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; seriesId: string | null; visitCount: number | null };
export type UpdateVisitState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; version: number | null };
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
    if (error instanceof VisitVersionConflictError) return { status: "error", message: "Выезд уже изменил другой сотрудник. Обновите страницу перед повтором.", fieldErrors: {}, version: null };
    if (error instanceof VisitNotFoundError) return { status: "error", message: "Выезд больше не существует или недоступен.", fieldErrors: {}, version: null };
    if (error instanceof VisitDuplicateError) return { status: "error", message: "У этого заказа уже есть выезд на выбранную дату и время.", fieldErrors: { localTime: ["Выберите другое время"] }, version: null };
    if (error instanceof VisitScheduleConflictError) return { status: "error", message: "У мастера уже есть другой выезд в это время.", fieldErrors: { assignedMasterId: ["Выберите другого мастера или время"] }, version: null };
    if (error instanceof VisitReferenceError) return { status: "error", message: "Мастер больше недоступен.", fieldErrors: {}, version: null };
    logUnexpected("service_visits.update", member.memberId, error);
    return { status: "error", message: "Не удалось сохранить выезд.", fieldErrors: {}, version: null };
  }
}

export async function rescheduleVisitAction(visitId: string, expectedVersion: number, localDate: string, localTime: string): Promise<RescheduleVisitResult> {
  if (getAuthMode() === "preview") return { status: "error", message: previewMessage, version: null, scheduledStartAt: null, scheduledEndAt: null };
  const member = await requireSession();
  const parsed = rescheduleVisitSchema.safeParse({ visitId, expectedVersion, localDate, localTime });
  if (!parsed.success) return { status: "error", message: "Проверьте дату и время выезда.", version: null, scheduledStartAt: null, scheduledEndAt: null };
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
    if (error instanceof VisitDuplicateError) return { status: "error", message: "У этого заказа уже есть выезд на выбранную дату и время.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    if (error instanceof VisitScheduleConflictError) return { status: "error", message: "У назначенного мастера уже есть выезд в это время.", version: null, scheduledStartAt: null, scheduledEndAt: null };
    logUnexpected("service_visits.reschedule", member.memberId, error);
    return { status: "error", message: "Не удалось перенести выезд. Расписание не изменено.", version: null, scheduledStartAt: null, scheduledEndAt: null };
  }
}
