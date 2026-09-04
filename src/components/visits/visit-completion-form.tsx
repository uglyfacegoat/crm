"use client";

import { AlertTriangle, Check, FileCheck2, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { completeVisitAction, type CompleteVisitState } from "@/app/(workspace)/calendar/actions";
import type { ServiceVisit } from "@/server/visits/types";
import { OrderField, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";

const initialState: CompleteVisitState = { status: "idle", message: null, fieldErrors: {}, documentId: null };

function visitDate(visit: ServiceVisit) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: visit.timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(visit.scheduledStartAt));
}

export function VisitCompletionForm({ visit, requestKey, onClose }: { visit: ServiceVisit; requestKey: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(completeVisitAction, initialState);
  const [filename, setFilename] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(onClose, 900);
    return () => window.clearTimeout(timeout);
  }, [onClose, state.status]);

  const defaultTitle = `Акт выполненных работ · ${visit.orderNumber ?? "выезд"} · ${visitDate(visit)}`;

  return <form action={action} className="flex min-h-0 flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <input type="hidden" name="visitId" value={visit.id} />
    <input type="hidden" name="expectedVersion" value={visit.version} />
    <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
      <section className="overflow-hidden rounded-[18px] border border-[var(--accent)]/15 bg-[linear-gradient(135deg,rgba(220,230,60,0.075),rgba(255,255,255,0.018)_62%)] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent)]/10 text-[var(--accent)]"><ShieldCheck className="size-5" /></span>
          <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Контроль закрытия</p><h3 className="mt-2 truncate text-sm font-semibold text-white">{visit.client}</h3><p className="mt-1 text-xs leading-5 text-[#7c868c]">{visit.object} · {visitDate(visit)}</p></div>
        </div>
        <p className="mt-4 text-[10px] leading-5 text-[#727c82]">Статус изменится только после сохранения проверенного файла. Акт автоматически попадёт в архив заказа и останется связан с этим выездом.</p>
      </section>

      <OrderField label="Название акта" required errors={state.fieldErrors.actTitle}>
        <input name="actTitle" required minLength={2} maxLength={240} defaultValue={defaultTitle} className={orderInputClass} />
      </OrderField>
      <OrderField label="Результат работ" required errors={state.fieldErrors.completionNotes}>
        <textarea name="completionNotes" required minLength={3} maxLength={4000} rows={5} placeholder="Что выполнено, результат осмотра, рекомендации клиенту…" className={orderTextareaClass} />
      </OrderField>
      <OrderField label="Подписанный акт" required errors={state.fieldErrors.file}>
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-[15px] border border-dashed border-white/[0.12] bg-black/10 px-4 py-5 text-center hover:border-[var(--accent)]/25 hover:bg-[var(--accent)]/[0.025] focus-within:border-[var(--accent)]/35 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]/35">
          <input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setFilename(event.currentTarget.files?.[0]?.name ?? null)} />
          {filename ? <><FileCheck2 className="size-6 text-[var(--success)]" /><span className="mt-2 max-w-full truncate text-xs text-[#d8ddd9]">{filename}</span><span className="mt-1 text-[9px] text-[#677178]">Нажмите, чтобы заменить</span></> : <><Upload className="size-6 text-[#768087]" /><span className="mt-2 text-xs text-[#b0b7ba]">Выбрать акт или фотографию</span><span className="mt-1 text-[9px] text-[#626c72]">PDF, JPG, PNG или WebP · до 15 МБ</span></>}
        </label>
      </OrderField>

      {state.message ? <div role={state.status === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[#5fc99a]/20 bg-[#5fc99a]/[0.05] text-[#84d7b2]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#df9296]"}`}>{state.status === "success" ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}{state.message}</div> : null}
    </div>
    <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-white/[0.07] bg-[#25272c] p-4 sm:flex-row sm:justify-end sm:px-7">
      <button type="button" onClick={onClose} disabled={pending} className="focus-ring h-11 rounded-[12px] border border-white/[0.08] px-5 text-xs text-[#aeb6ba] disabled:opacity-50">Отмена</button>
      <button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-5 text-xs font-semibold text-[#25272c] disabled:opacity-55">{pending ? <><LoaderCircle className="size-4 animate-spin" />Проверяем и сохраняем…</> : state.status === "success" ? <><Check className="size-4" />Выезд завершён</> : <><FileCheck2 className="size-4" />Завершить с актом</>}</button>
    </footer>
  </form>;
}
