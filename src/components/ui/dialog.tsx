"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

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
  return createPortal(<div className="fixed inset-0 z-[70] overflow-hidden bg-black/72 backdrop-blur-sm" onMouseDown={onClose} role="presentation"><div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onMouseDown={(event) => event.stopPropagation()} className="animate-slide-in absolute inset-y-0 left-0 flex h-full w-[100dvw] max-w-xl flex-col overflow-hidden border-l border-white/[0.09] bg-[#0d1317] shadow-[-28px_0_80px_rgba(0,0,0,0.42)] sm:left-auto sm:right-0"><header className="flex shrink-0 items-start gap-4 border-b border-white/[0.07] bg-[#0d1317] px-5 py-5 sm:px-7"><div className="min-w-0 flex-1"><h2 id={titleId} className="font-display text-xl font-semibold tracking-[-0.035em] text-white">{title}</h2>{description ? <p id={descriptionId} className="mt-2 text-xs leading-5 text-[#747e84]">{description}</p> : null}</div><button type="button" onClick={onClose} aria-label="Закрыть окно" className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] border border-white/[0.07] text-[#7b858b] hover:bg-white/[0.04] hover:text-white"><X className="size-4" /></button></header><div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div></div></div>, document.body);
}
