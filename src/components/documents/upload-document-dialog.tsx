"use client";

import { FileUp, Plus, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { uploadDocumentAction, type DocumentUploadState } from "@/app/(workspace)/documents/actions";
import { OrderField, OrderFormFooter, OrderFormStatus, OrderPicker, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import { documentCategoryLabels, type DocumentCategory, type DocumentUploadOptions } from "@/server/documents/types";

const initialState: DocumentUploadState = { status: "idle", message: null, fieldErrors: {} };
const visitDateFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" });

function UploadDocumentForm({ options, requestKey, onComplete }: { options: DocumentUploadOptions; requestKey: string; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(uploadDocumentAction, initialState);
  const [orderId, setOrderId] = useState("");
  const [visitId, setVisitId] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("act");
  const router = useRouter();
  const visits = useMemo(() => options.visits.filter((visit) => visit.orderId === orderId), [options.visits, orderId]);
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => { onComplete(); router.refresh(); }, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return <form action={formAction} className="flex min-h-full flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <input type="hidden" name="orderId" value={orderId} />
    <input type="hidden" name="visitId" value={visitId} />
    <input type="hidden" name="category" value={category} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      <OrderPicker label="Заказ" required value={orderId} onChange={(value) => { setOrderId(value); setVisitId(""); }} placeholder="Выберите заказ" errors={state.fieldErrors.orderId} options={options.orders.map((order) => ({ value: order.id, label: `№${order.number} · ${order.client}`, detail: `${order.object} · ${order.address}` }))} />
      <OrderPicker label="Выезд" value={visitId} onChange={setVisitId} placeholder={orderId ? "Без привязки к конкретному выезду" : "Сначала выберите заказ"} disabled={!orderId} errors={state.fieldErrors.visitId} options={[{ value: "", label: "Без конкретного выезда" }, ...visits.map((visit) => ({ value: visit.id, label: visitDateFormatter.format(new Date(visit.scheduledStartAt)), detail: visit.status }))]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <OrderPicker label="Категория" required value={category} onChange={(value) => setCategory(value as DocumentCategory)} placeholder="Выберите категорию" errors={state.fieldErrors.category} options={(Object.entries(documentCategoryLabels) as [DocumentCategory, string][]).map(([value, label]) => ({ value, label }))} />
        <OrderField label="Название" required errors={state.fieldErrors.title}><input name="title" required minLength={2} maxLength={240} placeholder="Акт выполненных работ" className={orderInputClass} /></OrderField>
      </div>
      <OrderField label="Описание" errors={state.fieldErrors.description}><textarea name="description" maxLength={2000} placeholder="Что важно знать об этом файле" className={orderTextareaClass} /></OrderField>
      <OrderField label="Файл до 15 МБ" required errors={state.fieldErrors.file}>
        <span className="focus-within:focus-ring flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-[14px] border border-dashed border-white/[0.12] bg-black/15 px-5 py-5 text-center hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/[0.025]">
          <UploadCloud className="size-6 text-[var(--accent)]" />
          <span className="mt-2 text-xs font-medium text-white">Выберите PDF, изображение, DOCX или XLSX</span>
          <span className="mt-1 text-[10px] text-[#687279]">Тип и содержимое проверяются на сервере</span>
          <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" className="mt-3 block max-w-full text-[10px] text-[#7e888e] file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.06] file:px-3 file:py-2 file:text-[10px] file:text-white" />
        </span>
      </OrderField>
      <OrderFormStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} disabled={!orderId} onCancel={onComplete} submitLabel="Загрузить документ" />
  </form>;
}

export function UploadDocumentButton({ options }: { options: DocumentUploadOptions }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <>
    <button type="button" onClick={() => setRequestKey(crypto.randomUUID())} disabled={!options.orders.length} title={options.orders.length ? undefined : "Сначала создайте заказ"} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[#25272c] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" />Добавить документ</button>
    <Dialog open={requestKey !== null} onClose={close} title="Новый документ" description="Файл получит связи с клиентом и объектом из выбранного заказа.">{requestKey ? <UploadDocumentForm options={options} requestKey={requestKey} onComplete={close} /> : null}</Dialog>
  </>;
}

export function EmptyDocumentsAction({ options }: { options: DocumentUploadOptions }) {
  return <div className="grid justify-items-center text-center"><span className="grid size-12 place-items-center rounded-[15px] bg-[var(--accent)]/[0.07] text-[var(--accent)]"><FileUp className="size-5" /></span><p className="mt-4 text-sm font-medium text-white">Архив пока пуст</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#707a80]">Добавьте договор, акт, фото или карточку выезда — связи с заказчиком сохранятся автоматически.</p><div className="mt-5"><UploadDocumentButton options={options} /></div></div>;
}
