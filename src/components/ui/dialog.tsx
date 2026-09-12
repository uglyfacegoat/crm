"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { formatPhoneInput } from "@/lib/phone-input";

export function Dialog({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleKeyDown); };
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(<div className="fixed inset-0 z-[70] overflow-hidden bg-black/76" onMouseDown={onClose} role="presentation"><div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onInputCapture={(event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.inputMode !== "tel") return;
    const formatted = formatPhoneInput(input.value);
    if (formatted === input.value) return;
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  }} onMouseDown={(event) => event.stopPropagation()} className="animate-slide-in absolute inset-y-0 left-0 flex h-full w-[100dvw] max-w-xl flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--surface)] sm:left-auto sm:right-0"><header className="flex shrink-0 items-start gap-4 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-5 sm:px-7"><div className="min-w-0 flex-1"><h2 id={titleId} className="font-display text-xl font-semibold tracking-[-0.035em] text-[var(--text)]">{title}</h2>{description ? <p id={descriptionId} className="mt-2 text-xs leading-5 text-[var(--muted)]">{description}</p> : null}</div><button type="button" onClick={onClose} aria-label="Закрыть окно" className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"><X className="size-4" /></button></header><div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div></div></div>, document.body);
}
