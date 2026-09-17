"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  DocumentFileValidationError,
  validateDocumentFile,
} from "@/server/documents/file-validation";
import {
  createDocumentStorageKey,
  removeDocumentFile,
  writeDocumentFile,
} from "@/server/documents/storage";
import {
  createInvoice,
  createMasterPayout,
  createPayment,
  FinanceAmountExceedsBalanceError,
  FinanceEntryConflictError,
  FinanceEntryNotFoundError,
  FinanceFutureDateError,
  FinanceInvoiceHasPaymentsError,
  FinanceInvoiceNumberConflictError,
  FinanceReferenceError,
  reverseMasterPayout,
  reversePayment,
  voidInvoice,
  type FinanceReceiptFile,
} from "@/server/finance/repository";
import {
  createInvoiceSchema,
  createPaymentSchema,
  createPayoutSchema,
  reverseLedgerEntrySchema,
  voidInvoiceSchema,
} from "@/server/finance/schemas";
import { formatMoneyMinor } from "@/lib/format";

export type FinanceActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

const emptyState: FinanceActionState = { status: "idle", message: null, fieldErrors: {} };

function validationFailure(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }, message: string): FinanceActionState {
  return {
    status: "error",
    message,
    fieldErrors: Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))),
  };
}

function knownFailure(error: unknown) {
  if (error instanceof FinanceReferenceError) return error.field === "master" ? "В заказе нет доступного мастера или начисления." : "Выбранная финансовая запись больше недоступна.";
  if (error instanceof FinanceAmountExceedsBalanceError) return `Сумма превышает доступный остаток ${formatMoneyMinor(Math.max(0, Number(error.availableMinor)))}.`;
  if (error instanceof FinanceInvoiceNumberConflictError) return "Счёт с таким номером уже существует.";
  if (error instanceof FinanceFutureDateError) return "Дата финансовой операции не может быть в будущем.";
  if (error instanceof FinanceEntryNotFoundError) return "Операция больше не существует или недоступна.";
  if (error instanceof FinanceEntryConflictError) return "Операцию уже изменил другой сотрудник. Обновите страницу.";
  if (error instanceof FinanceInvoiceHasPaymentsError) return "Счёт с проведёнными оплатами нельзя аннулировать. Сначала сторнируйте оплаты.";
  return null;
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

function refreshFinance(orderId?: string) {
  revalidatePath("/finance");
  revalidatePath("/documents");
  revalidatePath("/documents/archive");
  revalidatePath("/analytics");
  revalidatePath("/");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

async function storeReceipt(
  formData: FormData,
  organizationId: string,
  documentId: string,
): Promise<{ file: FinanceReceiptFile; created: boolean } | null> {
  const uploadedFile = formData.get("receipt");
  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) return null;
  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  const validated = validateDocumentFile({
    filename: uploadedFile.name,
    declaredMimeType: uploadedFile.type,
    buffer,
  });
  const storageKey = createDocumentStorageKey(
    organizationId,
    documentId,
    validated.extension,
  );
  let created = true;
  try {
    await writeDocumentFile(storageKey, buffer);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    created = false;
  }
  return { file: { documentId, storageKey, ...validated }, created };
}

async function removeUncommittedReceipt(receipt: { file: FinanceReceiptFile; created: boolean } | null) {
  if (!receipt?.created) return;
  try {
    await removeDocumentFile(receipt.file.storageKey);
  } catch (error) {
    console.error(JSON.stringify({ operation: "finance.receipt.cleanup", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
  }
}

export async function createInvoiceAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = createInvoiceSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), orderId: formData.get("orderId"), invoiceNumber: formData.get("invoiceNumber"),
    amount: formData.get("amount"), issuedOn: formData.get("issuedOn"), dueOn: formData.get("dueOn"), note: formData.get("note"),
  });
  if (!parsed.success) return validationFailure(parsed.error, "Проверьте номер, сумму и срок оплаты.");
  try {
    await createInvoice(member, parsed.data);
    refreshFinance(parsed.data.orderId);
    return { ...emptyState, status: "success", message: "Счёт выставлен и добавлен в дебиторку." };
  } catch (error) {
    const known = knownFailure(error); if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("finance.invoice.create", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось выставить счёт. Данные не сохранены." };
  }
}

export async function createPaymentAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = createPaymentSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), receiptDocumentId: formData.get("receiptDocumentId"), invoiceId: formData.get("invoiceId"), amount: formData.get("amount"),
    receivedOn: formData.get("receivedOn"), paymentMethod: formData.get("paymentMethod"), reference: formData.get("reference"), note: formData.get("note"),
  });
  if (!parsed.success) return validationFailure(parsed.error, "Проверьте сумму и реквизиты оплаты.");
  let receipt: Awaited<ReturnType<typeof storeReceipt>> = null;
  try {
    receipt = await storeReceipt(formData, member.organizationId, parsed.data.receiptDocumentId);
    await createPayment(member, parsed.data, receipt?.file ?? null);
    refreshFinance();
    return { ...emptyState, status: "success", message: "Оплата проведена." };
  } catch (error) {
    await removeUncommittedReceipt(receipt);
    if (error instanceof DocumentFileValidationError) return { ...emptyState, status: "error", message: error.message, fieldErrors: { receipt: [error.message] } };
    const known = knownFailure(error); if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("finance.payment.create", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось провести оплату. Данные не сохранены." };
  }
}

export async function createPayoutAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = createPayoutSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), receiptDocumentId: formData.get("receiptDocumentId"), orderId: formData.get("orderId"), amount: formData.get("amount"),
    paidOn: formData.get("paidOn"), paymentMethod: formData.get("paymentMethod"), reference: formData.get("reference"), note: formData.get("note"),
  });
  if (!parsed.success) return validationFailure(parsed.error, "Проверьте сумму и реквизиты выплаты.");
  let receipt: Awaited<ReturnType<typeof storeReceipt>> = null;
  try {
    receipt = await storeReceipt(formData, member.organizationId, parsed.data.receiptDocumentId);
    await createMasterPayout(member, parsed.data, receipt?.file ?? null);
    refreshFinance(parsed.data.orderId);
    return { ...emptyState, status: "success", message: "Выплата мастеру проведена." };
  } catch (error) {
    await removeUncommittedReceipt(receipt);
    if (error instanceof DocumentFileValidationError) return { ...emptyState, status: "error", message: error.message, fieldErrors: { receipt: [error.message] } };
    const known = knownFailure(error); if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("finance.payout.create", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось провести выплату. Данные не сохранены." };
  }
}

async function reverseEntry(formData: FormData, kind: "payment" | "payout"): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = reverseLedgerEntrySchema.safeParse({ entryId: formData.get("entryId"), expectedVersion: formData.get("expectedVersion"), reason: formData.get("reason") });
  if (!parsed.success) return validationFailure(parsed.error, "Укажите причину сторно.");
  try {
    if (kind === "payment") await reversePayment(member, parsed.data); else await reverseMasterPayout(member, parsed.data);
    refreshFinance();
    return { ...emptyState, status: "success", message: "Операция сторнирована и сохранена в истории." };
  } catch (error) {
    const known = knownFailure(error); if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected(`finance.${kind}.reverse`, member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось сторнировать операцию." };
  }
}

export async function reversePaymentAction(_previous: FinanceActionState, formData: FormData) { return reverseEntry(formData, "payment"); }
export async function reversePayoutAction(_previous: FinanceActionState, formData: FormData) { return reverseEntry(formData, "payout"); }

export async function voidInvoiceAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = voidInvoiceSchema.safeParse({ invoiceId: formData.get("invoiceId"), expectedVersion: formData.get("expectedVersion"), reason: formData.get("reason") });
  if (!parsed.success) return validationFailure(parsed.error, "Укажите причину аннулирования счёта.");
  try {
    await voidInvoice(member, parsed.data);
    refreshFinance();
    return { ...emptyState, status: "success", message: "Счёт аннулирован и сохранён в истории." };
  } catch (error) {
    const known = knownFailure(error); if (known) return { ...emptyState, status: "error", message: known };
    logUnexpected("finance.invoice.void", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось аннулировать счёт." };
  }
}
