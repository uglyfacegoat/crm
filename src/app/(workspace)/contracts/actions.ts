"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { contractIdSchema, createContractSchema, renewContractSchema, updateContractSchema } from "@/server/contracts/schemas";
import {
  ContractAlreadyRenewedError,
  ContractNotFoundError,
  ContractNumberConflictError,
  ContractPeriodLockedError,
  ContractReferenceError,
  ContractScheduleConflictError,
  ContractStateTransitionError,
  ContractVersionConflictError,
  createContract,
  listContractHistory,
  renewContract,
  updateContract,
} from "@/server/contracts/repository";
import type { ContractHistoryEvent } from "@/server/contracts/types";

export type ContractActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  contractId: string | null;
};
export type ContractHistoryResult = { status: "success"; events: ContractHistoryEvent[] } | { status: "error"; message: string };

const emptyState: ContractActionState = { status: "idle", message: null, fieldErrors: {}, contractId: null };

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function knownFailure(error: unknown) {
  if (error instanceof ContractNumberConflictError) return "Договор с таким номером уже существует.";
  if (error instanceof ContractReferenceError) return error.field === "master" ? "Выбранный мастер недоступен." : "Объект больше не существует или принадлежит другому клиенту.";
  if (error instanceof ContractScheduleConflictError) return "Мастер занят хотя бы в один из дней графика. Выберите другого мастера или создайте график без назначения.";
  if (error instanceof ContractNotFoundError) return "Договор больше не существует или недоступен.";
  if (error instanceof ContractVersionConflictError) return "Договор уже изменил другой сотрудник. Обновите страницу.";
  if (error instanceof ContractPeriodLockedError) return "Период действующего договора нельзя переписать. Для нового периода используйте продление.";
  if (error instanceof ContractStateTransitionError) return "Такой переход статуса договора запрещён.";
  if (error instanceof ContractAlreadyRenewedError) return "Для этого договора продление уже создано.";
  return null;
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function createContractAction(_previous: ContractActionState, formData: FormData): Promise<ContractActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает договоры." };
  const member = await requireSession();
  const parsed = createContractSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), clientId: formData.get("clientId"), objectId: formData.get("objectId"),
    contractNumber: formData.get("contractNumber"), status: formData.get("status"), startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"), renewalNoticeDays: formData.get("renewalNoticeDays"), notes: formData.get("notes"),
    scheduleEnabled: formData.get("scheduleEnabled") === "on", frequencyUnit: formData.get("frequencyUnit"),
    frequencyInterval: formData.get("frequencyInterval"), localTime: formData.get("localTime"),
    durationMinutes: formData.get("durationMinutes"), defaultMasterId: formData.get("defaultMasterId"),
  });
  if (!parsed.success) return { ...emptyState, status: "error", message: "Проверьте период, объект и параметры графика.", fieldErrors: fieldErrors(parsed.error) };
  try {
    const contractId = await createContract(member, parsed.data);
    revalidatePath("/contracts"); revalidatePath("/calendar"); revalidatePath("/tasks"); revalidatePath("/");
    return { status: "success", message: "Договор и плановый график сохранены.", fieldErrors: {}, contractId };
  } catch (error) {
    const known = knownFailure(error);
    if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("contract.create", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось создать договор. Данные не сохранены." };
  }
}

export async function updateContractAction(_previous: ContractActionState, formData: FormData): Promise<ContractActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает договоры." };
  const member = await requireSession();
  const parsed = updateContractSchema.safeParse({
    contractId: formData.get("contractId"), expectedVersion: formData.get("expectedVersion"), contractNumber: formData.get("contractNumber"),
    status: formData.get("status"), startsOn: formData.get("startsOn"), endsOn: formData.get("endsOn"),
    renewalNoticeDays: formData.get("renewalNoticeDays"), notes: formData.get("notes"), reason: formData.get("reason"),
  });
  if (!parsed.success) return { ...emptyState, status: "error", message: "Проверьте поля договора.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await updateContract(member, parsed.data);
    revalidatePath("/contracts"); revalidatePath("/");
    return { status: "success", message: "Договор обновлён, изменение записано в историю.", fieldErrors: {}, contractId: parsed.data.contractId };
  } catch (error) {
    const known = knownFailure(error);
    if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("contract.update", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось обновить договор." };
  }
}

export async function renewContractAction(_previous: ContractActionState, formData: FormData): Promise<ContractActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает договоры." };
  const member = await requireSession();
  const parsed = renewContractSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), sourceContractId: formData.get("sourceContractId"),
    expectedVersion: formData.get("expectedVersion"), contractNumber: formData.get("contractNumber"),
    startsOn: formData.get("startsOn"), endsOn: formData.get("endsOn"), renewalNoticeDays: formData.get("renewalNoticeDays"),
    copySchedule: formData.get("copySchedule") === "on",
  });
  if (!parsed.success) return { ...emptyState, status: "error", message: "Проверьте номер и новый период договора.", fieldErrors: fieldErrors(parsed.error) };
  try {
    const contractId = await renewContract(member, parsed.data);
    revalidatePath("/contracts"); revalidatePath("/calendar"); revalidatePath("/tasks"); revalidatePath("/");
    return { status: "success", message: "Продление создано отдельным периодом без изменения истории.", fieldErrors: {}, contractId };
  } catch (error) {
    const known = knownFailure(error);
    if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("contract.renew", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось продлить договор." };
  }
}

export async function getContractHistoryAction(contractId: string): Promise<ContractHistoryResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "История недоступна в режиме предпросмотра." };
  const member = await requireSession();
  const parsed = contractIdSchema.safeParse(contractId);
  if (!parsed.success) return { status: "error", message: "Некорректный идентификатор договора." };
  try { return { status: "success", events: await listContractHistory(member, parsed.data) }; }
  catch (error) {
    const known = knownFailure(error);
    if (known) return { status: "error", message: known };
    logUnexpected("contract.history", member.memberId, error);
    return { status: "error", message: "Не удалось загрузить историю договора." };
  }
}
