"use client";

import { AlertTriangle, Check, ClipboardCopy, Copy, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { formatVisitDispatchCardText, visitDispatchCardSchema, type VisitDispatchCard } from "@/lib/visits/dispatch-card";

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

function DispatchCardContent({ card, copyState, onCopy }: { card: VisitDispatchCard; copyState: CopyState; onCopy: () => void }) {
  const text = formatVisitDispatchCardText(card);
  return <div className="flex min-h-full flex-col">
    <div className="flex-1 space-y-4 p-4 sm:p-6">
      <pre className="whitespace-pre-wrap break-words rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 font-mono text-xs leading-6 text-[var(--text)] select-text sm:p-5">{text}</pre>
      {copyState === "error" ? <p role="alert" className="flex items-center gap-2 rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]"><AlertTriangle className="size-4" />Автокопирование недоступно. Выделите текст в поле вручную.</p> : null}
    </div>
    <footer className="sticky bottom-0 border-t border-[var(--line)] bg-[var(--surface-raised)]/95 p-4 backdrop-blur-xl sm:px-6"><button type="button" onClick={onCopy} className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)]">{copyState === "success" ? <><Check className="size-4" />Текст скопирован</> : <><Copy className="size-4" />Скопировать для мастера</>}</button></footer>
  </div>;
}

export function VisitDispatchCardButton({ visitId, compact = false, className = "", label = "Карточка мастеру" }: { visitId: string | null; compact?: boolean; className?: string; label?: string }) {
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
    <button type="button" draggable={false} disabled={!visitId} onPointerDown={(event) => event.stopPropagation()} onClick={openCard} aria-label={compact ? "Открыть карточку мастеру" : undefined} title={!visitId ? "Сначала добавьте выезд" : "Открыть готовое задание мастеру"} className={`${compact ? "grid size-7 place-items-center rounded-[8px] border border-[var(--line-strong)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text)]" : "soft-button flex h-10 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[13px] px-3 text-xs font-medium text-[var(--text-secondary)]"} focus-ring disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      <ClipboardCopy className={compact ? "size-3.5" : "size-4"} />{compact ? null : <span className="truncate">{label}</span>}
    </button>
    <Dialog open={open} onClose={close} title="Карточка мастеру">
      {loading ? <div className="grid min-h-80 place-items-center p-6 text-center"><div><LoaderCircle className="mx-auto size-6 animate-spin text-[var(--accent)]" /><p className="mt-3 text-xs text-[var(--muted)]">Собираем актуальные данные…</p></div></div> : error ? <div className="grid min-h-80 place-items-center p-6 text-center"><div className="max-w-sm"><AlertTriangle className="mx-auto size-7 text-[var(--danger)]" /><p role="alert" className="mt-3 text-sm text-[var(--text)]">{error}</p><button type="button" onClick={openCard} className="focus-ring mt-5 h-10 rounded-[12px] border border-[var(--line-strong)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]">Повторить</button></div></div> : card ? <DispatchCardContent card={card} copyState={copyState} onCopy={handleCopy} /> : null}
    </Dialog>
  </>;
}
