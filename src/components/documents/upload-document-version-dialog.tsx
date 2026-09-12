"use client";

import { FileClock, RefreshCw, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import { type DocumentUploadState, uploadDocumentVersionAction } from "@/app/(workspace)/documents/actions";
import { OrderField, OrderFormFooter, OrderFormStatus, orderTextareaClass } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { DocumentListItem } from "@/server/documents/types";

const initialState: DocumentUploadState = { status: "idle", message: null, fieldErrors: {} };

function UploadDocumentVersionForm({ document, requestKey, onComplete }: { document: DocumentListItem; requestKey: string; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(uploadDocumentVersionAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => { onComplete(); router.refresh(); }, 850);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return <form action={formAction} className="flex min-h-full flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <input type="hidden" name="documentId" value={document.id} />
    <input type="hidden" name="expectedVersion" value={document.recordVersion} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      <div className="grid gap-3 border-y border-[var(--line)] py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <span className="grid size-11 place-items-center rounded-[13px] bg-[var(--accent-soft)] text-[var(--accent)]"><FileClock className="size-5" /></span>
        <div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--text)]">{document.title}</p><p className="mt-1 truncate text-[10px] text-[var(--muted)]">{document.filename}</p></div>
        <div className="border-l border-[var(--line)] px-3 py-2 text-center"><p className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">Следующая</p><p className="mt-1 font-display text-lg font-semibold text-[var(--accent)]">v{document.versionNumber + 1}</p></div>
      </div>
      <OrderField label="Что изменилось" errors={state.fieldErrors.changeNote}>
        <textarea name="changeNote" maxLength={1000} placeholder="Например: исправлена дата, добавлена подпись заказчика" className={orderTextareaClass} />
      </OrderField>
      <OrderField label="Новый файл до 15 МБ" required errors={state.fieldErrors.file}>
        <span className="focus-within:focus-ring flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-[15px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-inset)] px-5 py-5 text-center hover:border-[var(--accent)]/45 hover:bg-[var(--accent-soft)]">
          <UploadCloud className="size-6 text-[var(--accent)]" />
          <span className="mt-2 text-xs font-medium text-[var(--text)]">PDF, изображение, DOCX или XLSX</span>
          <span className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Текущая версия останется доступна в истории</span>
          <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" className="mt-3 block max-w-full text-[10px] text-[var(--muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-soft)] file:px-3 file:py-2 file:text-[10px] file:text-[var(--text-secondary)]" />
        </span>
      </OrderField>
      <OrderFormStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel={`Сохранить версию ${document.versionNumber + 1}`} />
  </form>;
}

export function UploadDocumentVersionButton({ document }: { document: DocumentListItem }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <>
    <button type="button" onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"><RefreshCw className="size-4 text-[var(--accent)]" />Новая версия</button>
    <Dialog open={requestKey !== null} onClose={close} title="Новая версия документа" description="Файл станет текущим, а предыдущие версии останутся неизменяемыми.">
      {requestKey ? <UploadDocumentVersionForm document={document} requestKey={requestKey} onComplete={close} /> : null}
    </Dialog>
  </>;
}
