"use client";

import { AlertTriangle, Building2, CalendarClock, Check, ClipboardCopy, Copy, LoaderCircle, MapPin, Phone, UserRound, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { formatMoneyMinor } from "@/lib/format";
import { formatVisitDispatchCardText, formatVisitDispatchWindow, visitDispatchCardSchema, type VisitDispatchCard } from "@/lib/visits/dispatch-card";

const dispatchCardResponseSchema = z.object({ data: visitDispatchCardSchema });
const dispatchCardErrorSchema = z.object({ error: z.object({ message: z.string() }) });

type CopyState = "idle" | "success" | "error";

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Local network deployments can expose the Clipboard API but reject it without HTTPS.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Browser rejected clipboard operation.");
}

function CardField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex min-w-0 gap-3 rounded-[13px] border border-white/[0.065] bg-black/10 p-3.5"><span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-white/[0.045] text-[#899399]">{icon}</span><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#626c72]">{label}</p><p className="mt-1.5 break-words text-xs leading-5 text-[#d9ddda]">{value}</p></div></div>;
}

function DispatchCardContent({ card, copyState, onCopy }: { card: VisitDispatchCard; copyState: CopyState; onCopy: () => void }) {
  const text = formatVisitDispatchCardText(card);
  return <div className="flex min-h-full flex-col">
    <div className="flex-1 space-y-5 p-4 sm:p-6">
      <section className="overflow-hidden rounded-[18px] border border-[var(--accent)]/15 bg-[linear-gradient(145deg,rgba(220,230,60,0.08),rgba(255,255,255,0.018)_52%)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Задание на выезд</p><p className="mt-2 font-display text-xl font-semibold tracking-[-0.035em] text-white">{card.orderNumber ?? "Без номера заказа"}</p></div><span className="rounded-full border border-white/[0.08] bg-black/15 px-3 py-1.5 text-[9px] text-[#aab2b6]">{card.status}</span></div>
        <p className="mt-5 flex items-start gap-2 text-sm font-medium leading-6 text-[#eef0ec]"><CalendarClock className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />{formatVisitDispatchWindow(card)}</p>
      </section>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <CardField icon={<Building2 className="size-4" />} label="Юридическое лицо" value={card.client} />
        <CardField icon={<MapPin className="size-4" />} label="Объект" value={`${card.object} · ${card.address}`} />
        <CardField icon={<Phone className="size-4" />} label="Контакт на объекте" value={`${card.contactName ?? "Не указан"}${card.contactPhone ? ` · ${card.contactPhone}` : ""}`} />
        <CardField icon={<UserRound className="size-4" />} label="Мастер" value={`${card.master ?? "Не назначен"}${card.masterPhone ? ` · ${card.masterPhone}` : ""}`} />
      </div>

      <section className="rounded-[16px] border border-white/[0.065] bg-white/[0.018] p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xs font-semibold text-white"><Wrench className="size-4 text-[#8b959a]" />Состав работ</h3><span className="text-[9px] text-[#636d73]">{card.services.length} поз.</span></div>
        {card.services.length ? <ol className="mt-3 divide-y divide-white/[0.055]">{card.services.map((service, index) => <li key={`${service.name}-${index}`} className="grid gap-1 py-3 first:pt-1 last:pb-0 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]"><span className="font-display text-[10px] text-[var(--accent)]">{String(index + 1).padStart(2, "0")}</span><div><p className="text-xs text-[#dce0dc]">{service.name}</p>{service.note ? <p className="mt-1 text-[10px] leading-4 text-[#6f797f]">{service.note}</p> : null}</div><span className="text-[10px] text-[#899297]">× {Number(service.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</span></li>)}</ol> : <p className="mt-3 text-xs text-[#6d777d]">Работы в заказе не указаны.</p>}
      </section>

      {card.masterPaymentMinor !== undefined || card.notes ? <div className="grid gap-2.5 sm:grid-cols-2">{card.masterPaymentMinor !== undefined ? <CardField icon={<span className="font-display text-xs">₽</span>} label="Выплата мастеру" value={card.masterPaymentMinor === null ? "Не указана для этого мастера" : formatMoneyMinor(card.masterPaymentMinor)} /> : null}{card.notes ? <CardField icon={<ClipboardCopy className="size-4" />} label="Комментарий к выезду" value={card.notes} /> : null}</div> : null}

      <label className="block"><span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#626c72]">Готовый текст</span><textarea readOnly value={text} rows={12} onFocus={(event) => event.currentTarget.select()} className="focus-ring mt-2 w-full resize-none rounded-[14px] border border-white/[0.07] bg-[#090e11] p-4 font-mono text-[11px] leading-5 text-[#aeb6b2]" /></label>
      {copyState === "error" ? <p role="alert" className="flex items-center gap-2 rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.05] p-3 text-xs text-[#dc969a]"><AlertTriangle className="size-4" />Автокопирование недоступно. Выделите текст в поле вручную.</p> : null}
    </div>
    <footer className="sticky bottom-0 border-t border-white/[0.07] bg-[#25272c]/94 p-4 backdrop-blur-xl sm:px-6"><button type="button" onClick={onCopy} className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] text-xs font-semibold text-[#25272c]">{copyState === "success" ? <><Check className="size-4" />Текст скопирован</> : <><Copy className="size-4" />Скопировать для мастера</>}</button></footer>
  </div>;
}

export function VisitDispatchCardButton({ visitId, compact = false, className = "" }: { visitId: string | null; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState<VisitDispatchCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const requestSequence = useRef(0);

  async function openCard(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!visitId) return;
    const sequence = ++requestSequence.current;
    setOpen(true);
    setLoading(true);
    setError(null);
    setCopyState("idle");
    try {
      const response = await fetch(`/api/v1/visits/${encodeURIComponent(visitId)}/dispatch-card`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsedError = dispatchCardErrorSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error.message : "Не удалось загрузить карточку выезда.");
      }
      const parsed = dispatchCardResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Сервер вернул некорректную карточку выезда.");
      if (requestSequence.current === sequence) setCard(parsed.data.data);
    } catch (requestError) {
      if (requestSequence.current === sequence) setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить карточку выезда.");
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }

  async function handleCopy() {
    if (!card) return;
    try {
      await copyText(formatVisitDispatchCardText(card));
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }

  function close() {
    requestSequence.current += 1;
    setOpen(false);
    setLoading(false);
  }

  return <>
    <button type="button" draggable={false} disabled={!visitId} onPointerDown={(event) => event.stopPropagation()} onClick={openCard} aria-label={compact ? "Открыть карточку мастеру" : undefined} title={!visitId ? "Сначала добавьте выезд" : "Открыть готовое задание мастеру"} className={`${compact ? "grid size-7 place-items-center rounded-[8px] border border-white/[0.09] bg-black/15 text-white/70 hover:text-white" : "soft-button flex h-10 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[13px] px-3 text-xs font-medium text-[#c8ced1]"} focus-ring disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      <ClipboardCopy className={compact ? "size-3.5" : "size-4"} />{compact ? null : <span>Карточка мастеру</span>}
    </button>
    <Dialog open={open} onClose={close} title="Карточка выезда" description="Готовое задание можно проверить и отправить мастеру без ручного переписывания.">
      {loading ? <div className="grid min-h-80 place-items-center p-6 text-center"><div><LoaderCircle className="mx-auto size-6 animate-spin text-[var(--accent)]" /><p className="mt-3 text-xs text-[#747e84]">Собираем актуальные данные…</p></div></div> : error ? <div className="grid min-h-80 place-items-center p-6 text-center"><div className="max-w-sm"><AlertTriangle className="mx-auto size-7 text-[#ef858a]" /><p role="alert" className="mt-3 text-sm text-white">{error}</p><button type="button" onClick={openCard} className="focus-ring mt-5 h-10 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#aeb6ba]">Повторить</button></div></div> : card ? <DispatchCardContent card={card} copyState={copyState} onCopy={handleCopy} /> : null}
    </Dialog>
  </>;
}
