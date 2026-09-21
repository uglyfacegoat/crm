"use client";

import { Check, Download, FileCheck2, FileUp, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import {
  type DocumentTemplateMutationState,
  updateDocumentTemplateStatusAction,
  uploadDocumentTemplateAction,
} from "@/app/(workspace)/settings/template-actions";
import { OrderField, OrderFormFooter, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";

const initialState: DocumentTemplateMutationState = { status: "idle", message: null, fieldErrors: {} };

function Status({ state }: { state: DocumentTemplateMutationState }) {
  if (!state.message) return null;
  return <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p>;
}

function UploadTemplateForm({ requestKey, onComplete }: { requestKey: string; onComplete: () => void }) {
  const [state, action, pending] = useActionState(uploadDocumentTemplateAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success" || state.refreshRequired) return;
    const timeout = window.setTimeout(() => { onComplete(); router.refresh(); }, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status, state.refreshRequired]);
  return <form action={action} className="flex min-h-full flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      <OrderField label="Название формы" required errors={state.fieldErrors.title}><input name="title" required minLength={2} maxLength={240} placeholder="Акт выполненных работ — стандартный" className={orderInputClass} /></OrderField>
      <OrderField label="Когда использовать" errors={state.fieldErrors.description}><textarea name="description" maxLength={2000} placeholder="Например: для разовых работ по дезинсекции" className={orderTextareaClass} /></OrderField>
      <OrderField label="Утверждённый PDF или DOCX до 15 МБ" required errors={state.fieldErrors.file}>
        <span className="focus-within:focus-ring flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-inset)] px-5 py-5 text-center hover:border-[var(--accent)]/30">
          <FileUp className="size-6 text-[var(--accent)]" /><span className="mt-2 text-xs font-medium text-[var(--text)]">Выберите готовую форму</span><span className="mt-1 text-[10px] leading-4 text-[var(--muted)]">CRM не подставляет юридические реквизиты и не изменяет содержимое файла</span>
          <input name="file" type="file" required accept=".pdf,.docx" className="mt-3 block max-w-full text-[10px] text-[var(--muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-raised)] file:px-3 file:py-2 file:text-[10px] file:text-[var(--text)]" />
        </span>
      </OrderField>
      <Status state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel="Опубликовать шаблон" />
  </form>;
}

function UploadTemplateButton({ preview }: { preview: boolean }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <><button type="button" disabled={preview} onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-45"><Plus className="size-4" />Добавить шаблон</button><Dialog open={requestKey !== null} onClose={close} title="Шаблон закрывающего акта" description="Загрузите утверждённую компанией форму без автоматического изменения её реквизитов.">{requestKey ? <UploadTemplateForm requestKey={requestKey} onComplete={close} /> : null}</Dialog></>;
}

function TemplateStatusButton({ template, preview }: { template: DocumentTemplateListItem; preview: boolean }) {
  const [state, action, pending] = useActionState(updateDocumentTemplateStatusAction, initialState);
  return <form action={action} className="min-w-0"><input type="hidden" name="templateId" value={template.id} /><input type="hidden" name="expectedVersion" value={template.version} /><input type="hidden" name="active" value={String(!template.active)} /><button disabled={preview || pending || state.status === "success"} className="focus-ring flex min-h-10 w-full items-center justify-center gap-2 rounded-[11px] border border-[var(--line)] px-3 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)] disabled:opacity-45">{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{template.active ? "Снять с публикации" : "Опубликовать снова"}</button>{state.status === "error" ? <p role="alert" className="mt-2 text-[9px] leading-4 text-[var(--danger-ink)]">{state.message}</p> : null}</form>;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function DocumentTemplatePanel({ templates, preview }: { templates: DocumentTemplateListItem[]; preview: boolean }) {
  return <div className="mt-5 space-y-4">
    <section className="surface-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><ShieldCheck className="size-5" /></span><div className="min-w-0 flex-1"><h2 className="font-display text-base font-semibold text-[var(--text)]">Утверждённые формы компании</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">Мастер скачивает исходный PDF или DOCX и прикладывает уже подписанный акт при закрытии выезда. CRM проверяет целостность каждого скачивания.</p></div><UploadTemplateButton preview={preview} /></section>
    {templates.length ? <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{templates.map((template) => <article key={template.id} className="surface-panel flex min-w-0 flex-col p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-[var(--support-soft)] text-[var(--support-strong)]"><FileCheck2 className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium leading-5 text-[var(--text)]">{template.title}</h3><span className={`rounded-full px-2 py-1 text-[9px] ${template.active ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{template.active ? "Опубликован" : "Скрыт"}</span></div><p className="mt-1 truncate text-[10px] text-[var(--muted)]">{template.filename} · {formatSize(template.sizeBytes)}</p></div></div>{template.description ? <p className="mt-4 flex-1 text-xs leading-5 text-[var(--text-secondary)]">{template.description}</p> : <div className="flex-1" />}<p className="mt-4 text-[9px] leading-4 text-[var(--muted)]">Версия {template.versionNumber} · {template.uploadedBy}</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><a href={`/api/v1/document-templates/${template.id}/download`} className="focus-ring flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[var(--accent-soft)] px-3 text-[10px] font-medium text-[var(--accent-ink)]"><Download className="size-3.5" />Скачать</a><TemplateStatusButton template={template} preview={preview} /></div></article>)}</section> : <section className="surface-panel grid min-h-64 place-items-center p-8 text-center"><div><FileCheck2 className="mx-auto size-8 text-[var(--muted)]" /><h2 className="mt-4 font-display text-lg font-semibold text-[var(--text)]">Шаблонов пока нет</h2><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">Добавьте только утверждённые компанией формы. Система не будет придумывать или менять юридический текст.</p></div></section>}
  </div>;
}
