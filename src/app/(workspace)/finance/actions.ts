"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { revalidatePath } from "next/cache";
import { FileWriteLeaseLostError, FileWritesPausedError, markFileWriteUncertain, withFileWriteLease } from "../../../server/file-writes/gate.mjs";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
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
  financeMutationExists,
  FinanceAmountExceedsBalanceError,
  FinanceEntryConflictError,
  FinanceEntryNotFoundError,
  FinanceFutureDateError,
  FinanceInvoiceHasPaymentsError,
  FinanceInvoiceNumberConflictError,
  FinanceReferenceError,
  FinanceRequestConflictError,
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
  refreshRequired?: true;
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
  if (error instanceof AuthorizationError) return "У вас нет права изменять финансовые операции.";
  if (error instanceof FinanceRequestConflictError) return "Этот запрос уже использован для другой операции. Обновите историю и откройте новую форму.";
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
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, errorCode: safeErrorCode(error) }));
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
): Promise<FinanceReceiptFile | null> {
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
  try {
    await writeDocumentFile(storageKey, buffer);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    throw new DocumentFileValidationError("Файл этого запроса уже существует. Проверьте историю операций. Если операция не проведена, закройте форму и создайте новую.");
  }
  return { documentId, storageKey, ...validated };
}

async function removeUncommittedReceipt(receipt: FinanceReceiptFile | null) {
  if (!receipt) return;
  try {
    await removeDocumentFile(receipt.storageKey);
  } catch (error) {
    markFileWriteUncertain();
    console.error(JSON.stringify({ operation: "finance.receipt.cleanup", category: "unexpected", errorCode: safeErrorCode(error) }));
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

async function createPaymentActionImpl(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = createPaymentSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), receiptDocumentId: formData.get("receiptDocumentId"), invoiceId: formData.get("invoiceId"), amount: formData.get("amount"),
    receivedOn: formData.get("receivedOn"), paymentMethod: formData.get("paymentMethod"), reference: formData.get("reference"), note: formData.get("note"),
  });
  if (!parsed.success) return validationFailure(parsed.error, "Проверьте сумму и реквизиты оплаты.");
  let receipt: Awaited<ReturnType<typeof storeReceipt>> = null;
  let committed = false;
  try {
    committed = await financeMutationExists(member, parsed.data.idempotencyKey, "finance.payment.create");
    if (!committed) {
      receipt = await storeReceipt(formData, member.organizationId, parsed.data.receiptDocumentId);
      const result = await createPayment(member, parsed.data, receipt);
      committed = true;
      if (!result.created) await removeUncommittedReceipt(receipt);
    }
    refreshFinance();
    return { ...emptyState, status: "success", message: "Оплата проведена." };
  } catch (error) {
    if (committed) {
      logUnexpected("finance.payment.revalidate", member.memberId, error);
      return { ...emptyState, status: "success", refreshRequired: true, message: "Оплата проведена, но страницу не удалось обновить. Обновите её вручную." };
    }
    if (error instanceof DocumentFileValidationError) return { ...emptyState, status: "error", message: error.message, fieldErrors: { receipt: [error.message] } };
    const known = knownFailure(error);
    if (known) {
      await removeUncommittedReceipt(receipt);
      return { ...emptyState, status: "error", message: known };
    }
    markFileWriteUncertain();
    logUnexpected("finance.payment.create", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось подтвердить оплату. Обновите историю оплат и проверьте результат перед повторной отправкой." };
  }
}

async function createPayoutActionImpl(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  if (getAuthMode() === "preview") return { ...emptyState, status: "error", message: "Предпросмотр не записывает финансовые операции." };
  const member = await requireSession();
  const parsed = createPayoutSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"), receiptDocumentId: formData.get("receiptDocumentId"), orderId: formData.get("orderId"), amount: formData.get("amount"),
    paidOn: formData.get("paidOn"), paymentMethod: formData.get("paymentMethod"), reference: formData.get("reference"), note: formData.get("note"),
  });
  if (!parsed.success) return validationFailure(parsed.error, "Проверьте сумму и реквизиты выплаты.");
  let receipt: Awaited<ReturnType<typeof storeReceipt>> = null;
  let committed = false;
  try {
    committed = await financeMutationExists(member, parsed.data.idempotencyKey, "finance.payout.create");
    if (!committed) {
      receipt = await storeReceipt(formData, member.organizationId, parsed.data.receiptDocumentId);
      const result = await createMasterPayout(member, parsed.data, receipt);
      committed = true;
      if (!result.created) await removeUncommittedReceipt(receipt);
    }
    refreshFinance(parsed.data.orderId);
    return { ...emptyState, status: "success", message: "Выплата мастеру проведена." };
  } catch (error) {
    if (committed) {
      logUnexpected("finance.payout.revalidate", member.memberId, error);
      return { ...emptyState, status: "success", refreshRequired: true, message: "Выплата проведена, но страницу не удалось обновить. Обновите её вручную." };
    }
    if (error instanceof DocumentFileValidationError) return { ...emptyState, status: "error", message: error.message, fieldErrors: { receipt: [error.message] } };
    const known = knownFailure(error);
    if (known) {
      await removeUncommittedReceipt(receipt);
      return { ...emptyState, status: "error", message: known };
    }
    markFileWriteUncertain();
    logUnexpected("finance.payout.create", member.memberId, error);
    return { ...emptyState, status: "error", message: "Не удалось подтвердить выплату. Обновите историю выплат и проверьте результат перед повторной отправкой." };
  }
}

async function guardedFinanceReceipt(operation: () => Promise<FinanceActionState>): Promise<FinanceActionState> {
  await requireSession();
  try {
    return await withFileWriteLease(operation);
  } catch (error) {
    if (error instanceof FileWritesPausedError) return { ...emptyState, status: "error", message: "Загрузка файлов временно остановлена. Повторите операцию позже; оплата или выплата не проводилась." };
    if (error instanceof FileWriteLeaseLostError) return { ...emptyState, status: "error", message: "Не удалось подтвердить результат. Проверьте историю операций перед повторной отправкой." };
    throw error;
  }
}

export async function createPaymentAction(previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const receipt = formData.get("receipt");
  if (getAuthMode() === "preview" || !(receipt instanceof File) || receipt.size === 0) return createPaymentActionImpl(previous, formData);
  return guardedFinanceReceipt(() => createPaymentActionImpl(previous, formData));
}

export async function createPayoutAction(previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const receipt = formData.get("receipt");
  if (getAuthMode() === "preview" || !(receipt instanceof File) || receipt.size === 0) return createPayoutActionImpl(previous, formData);
  return guardedFinanceReceipt(() => createPayoutActionImpl(previous, formData));
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
