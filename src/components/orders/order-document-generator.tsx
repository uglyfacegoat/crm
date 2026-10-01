"use client";
import { useActionState, useCallback, useEffect, useState } from "react";
import { Check, FilePlus2 } from "lucide-react";
import { generateOrderDocumentAction, type GenerateOrderDocumentState } from "@/app/(workspace)/orders/document-generation-actions";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-time-inputs";
import { clientCrypto } from "@/lib/client-id";
import type { OrderGenerationTemplate } from "@/server/document-templates/types";
import type { OrderDetail } from "@/server/orders/types";
import type { ServiceVisit } from "@/server/visits/types";
import { OrderField, OrderFormFooter, OrderPicker, orderInputClass, orderTextareaClass } from "./order-form-parts";

type DocumentOrder = Pick<OrderDetail, "id" | "version" | "number" | "client" | "object" | "address" | "master" | "objectAreaSquareMeters" | "services">;
const emptyState: GenerateOrderDocumentState = { status: "idle", message: null, documentId: null, fieldErrors: {} };
const localDate = (date = new Date(), timezone = "Europe/Moscow") => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(date);
function GenerationForm({ order, template, visits, requestKey, onClose, onCreated }: { order: DocumentOrder; template: OrderGenerationTemplate; visits: ServiceVisit[]; requestKey: string; onClose: () => void; onCreated: (id: string) => void }) {
  function deriveAreas(rows: Array<{ name: string; quantity: string; unit?: string | null }>) {
    return ["дератиз", "дезинсек", "дезинфек"].map(word => {
      const row = rows.find(item => item.name.toLocaleLowerCase("ru-RU").includes(word));
      return row ? String(["м²", "м2"].includes(row.unit ?? "") ? row.quantity : order.objectAreaSquareMeters ?? "").replace(".", ",") : "";
    });
  }
  const [state, action, pending] = useActionState(generateOrderDocumentAction, emptyState);
  const [visitId, setVisitId] = useState("none");
  const [documentDate, setDocumentDate] = useState(localDate);
  const [executorName, setExecutorName] = useState(order.master ?? "");
  const [services, setServices] = useState(order.services.map(row => row.name).join(", "));
  const [areas, setAreas] = useState(() => deriveAreas(order.services));
  const fields = template.generationFields ?? [];
  const deriveVisit = (id: string) => {
    setVisitId(id);
    const visit = visits.find(row => row.id === id);
    const rows = visit?.serviceLines ?? order.services;
    setServices(rows.map(row => row.name).join(", "));
    setExecutorName(visit ? visit.master ?? "" : order.master ?? "");
    setAreas(deriveAreas(rows));
    setDocumentDate(visit ? localDate(new Date(visit.scheduledStartAt), visit.timezone) : localDate());
  };
  useEffect(() => { if (state.status === "success" && state.documentId) onCreated(state.documentId); }, [state.status, state.documentId, onCreated]);
  return <form action={action} className="flex flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="expectedOrderVersion" value={order.version} />
    <input type="hidden" name="templateId" value={template.id} /><input type="hidden" name="expectedTemplateVersion" value={template.version} /><input type="hidden" name="visitId" value={visitId === "none" ? "" : visitId} />
    <div className="space-y-5 p-5 sm:p-7">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] p-4"><p className="text-sm font-semibold">{template.title}</p><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{order.number} · {order.client}<br />{order.object} · {order.address}</p><p className="mt-2 text-xs text-[var(--muted)]">Документ появится в списке документов этого заказа.</p></div>
      {visits.length ? <OrderPicker label="Данные для акта" value={visitId} onChange={deriveVisit} options={[{ value: "none", label: "По заказу" }, ...visits.filter(row => row.statusCode !== "cancelled").map(row => ({ value: row.id, label: new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: row.timezone }).format(new Date(row.scheduledStartAt)), detail: `${row.master ?? "Без мастера"} · ${row.status}` }))]} placeholder="Выберите выезд" /> : null}
      <div className="grid gap-4 sm:grid-cols-2"><OrderField label="Дата документа" required><DateInput key={visitId} name="documentDate" value={documentDate} onChange={setDocumentDate} required /></OrderField><OrderField label="Исполнитель"><input name="executorName" aria-label="Исполнитель" value={executorName} onChange={event => setExecutorName(event.target.value)} maxLength={200} className={orderInputClass} placeholder="ФИО мастера" /></OrderField></div>
      <OrderField label="Выполненные работы"><textarea name="services" aria-label="Выполненные работы" value={services} onChange={event => setServices(event.target.value)} maxLength={1800} className={orderTextareaClass} /></OrderField>
      {fields.some(field => field.startsWith("area_")) ? <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Площадь обработки</h3>{order.objectAreaSquareMeters ? <span className="text-xs text-[var(--muted)]">Объект: {Number(order.objectAreaSquareMeters).toLocaleString("ru-RU")} м²</span> : null}</div><div className="grid gap-3 sm:grid-cols-3">{([['areaDeratization', 'Дератизация, м²', 'area_deratization'], ['areaDisinsection', 'Дезинсекция, м²', 'area_disinsection'], ['areaDisinfection', 'Дезинфекция, м²', 'area_disinfection']] as const).map(([name,label,field], index) => fields.includes(field) ? <OrderField key={name} label={label}><input name={name} aria-label={label} value={areas[index]} onChange={event => setAreas(previous => previous.map((value, position) => position === index ? event.target.value : value))} inputMode="decimal" className={orderInputClass} placeholder="Не выполнялась" /></OrderField> : <input key={name} type="hidden" name={name} value="" />)}</div></section> : null}
      {fields.includes("preparations") ? <OrderField label="Использованные препараты"><textarea name="preparations" aria-label="Использованные препараты" defaultValue={template.generationDefaults?.preparations ?? ""} maxLength={1500} className={orderTextareaClass} /></OrderField> : null}
      {fields.includes("recommendations") ? <OrderField label="Рекомендации"><textarea name="recommendations" aria-label="Рекомендации" defaultValue={template.generationDefaults?.recommendations ?? ""} maxLength={1500} className={orderTextareaClass} /></OrderField> : null}
      <p className="text-xs text-[var(--muted)]">Подписи мастера и представителя объекта заполняются на готовом акте.</p>
      {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-xs leading-5 ${state.status === "error" ? "bg-[var(--danger-bg)] text-[var(--danger-ink)]" : "bg-[var(--success-bg)] text-[var(--success)]"}`}>{state.message}{Object.values(state.fieldErrors).flat().length ? ` ${Object.values(state.fieldErrors).flat().join(". ")}` : ""}</p> : null}
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Сгенерировать и прикрепить" />
  </form>;
}

export function OrderDocumentGenerator({ order, templates, visits, preview }: { order: DocumentOrder; templates: OrderGenerationTemplate[]; visits: ServiceVisit[]; preview: boolean }) {
  const [templateId, setTemplateId] = useState(templates.find(row => row.generationKind)?.id ?? templates[0]?.id ?? "");
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [createdFile, setCreatedFile] = useState<{ id: string; extension: "pdf" | "docx" } | null>(null);
  const template = templates.find(row => row.id === templateId);
  const onClose = useCallback(() => setRequestKey(null), []);
  const onCreated = useCallback((id: string) => { setCreatedFile({ id, extension: template?.extension ?? "pdf" }); setRequestKey(null); }, [template?.extension]);
  return <section aria-label="Генерация документа" className="surface-panel p-5 sm:p-6">
    <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><FilePlus2 className="size-5" /></span><div><h2 className="text-base font-semibold">Документ по шаблону</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Выберите форму, проверьте данные и прикрепите готовый документ к заказу.</p></div></div>
    {templates.length ? <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><OrderPicker label="Шаблон документа" value={templateId} onChange={setTemplateId} options={templates.map(row => ({ value: row.id, label: row.title, detail: row.generationKind ? `${row.extension.toUpperCase()} · автозаполнение` : "Бланк для скачивания" }))} placeholder="Выберите шаблон" /></div><button type="button" disabled={preview || !template?.generationKind} onClick={() => setRequestKey(clientCrypto.randomUUID())} className="focus-ring inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--text)] px-5 text-xs font-semibold text-[var(--canvas)] disabled:opacity-40"><FilePlus2 className="size-4" />Сгенерировать</button></div> : <p className="mt-5 text-sm text-[var(--muted)]">Опубликованных шаблонов пока нет. Добавьте форму в настройках компании.</p>}
    {template && !template.generationKind ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Этот шаблон предназначен для заполнения вручную. <a className="focus-ring underline" href={`/api/v1/document-templates/${template.id}/download`}>Скачать бланк</a></p> : null}
    {createdFile ? <div role="status" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--success-bg)] p-3 text-xs text-[var(--success)]"><Check className="size-4" />Документ прикреплён к заказу.<a href={`/api/v1/documents/${createdFile.id}/${createdFile.extension === "docx" ? "preview" : "download?disposition=inline"}`} target="_blank" rel="noopener noreferrer" className="focus-ring ml-auto underline">Открыть</a><a href={`/api/v1/documents/${createdFile.id}/download`} className="focus-ring underline">Скачать</a></div> : null}
    <Dialog open={Boolean(requestKey && template)} onClose={onClose} title="Документ по шаблону" description="Проверьте данные акта перед сохранением." bodyClassName="flex flex-col">
      {requestKey && template ? <GenerationForm key={requestKey} order={order} template={template} visits={visits} requestKey={requestKey} onClose={onClose} onCreated={onCreated} /> : null}
    </Dialog>
  </section>;
}
