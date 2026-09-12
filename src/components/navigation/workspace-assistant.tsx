"use client";

import {
  ArrowRight,
  ArrowUp,
  Maximize2,
  Minimize2,
  Minus,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { matchesSearchText } from "@/lib/search-normalization";

const destinations = [
  { href: "/tasks", label: "Задачи", keywords: ["задача", "просрочено", "очередь", "срок"] },
  { href: "/masters", label: "Мастера", keywords: ["мастер", "загрузка", "исполнитель", "график"] },
  { href: "/documents", label: "Документы", keywords: ["документ", "файл", "акт", "архив"] },
  { href: "/calendar", label: "Календарь", keywords: ["выезд", "дата", "расписание", "календарь"] },
  { href: "/orders", label: "Заказы", keywords: ["заказ", "клиент", "согласование"] },
  { href: "/finance", label: "Финансы", keywords: ["деньги", "финансы", "оплата", "расход"] },
] as const;

const quickPrompts = ["Просроченные задачи", "Загрузка мастеров", "Найти документ"];
type AssistantState = "closed" | "open" | "minimized";

export function WorkspaceAssistant() {
  const pathname = usePathname();
  const [state, setState] = useState<AssistantState>("closed");
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const destination = useMemo(
    () => destinations.find((entry) => matchesSearchText(submittedPrompt, [entry.label, ...entry.keywords])) ?? null,
    [submittedPrompt],
  );

  useEffect(() => {
    if (state !== "open") return;
    const minimizeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setState("minimized");
    };
    window.addEventListener("keydown", minimizeOnEscape);
    return () => window.removeEventListener("keydown", minimizeOnEscape);
  }, [state]);

  function submit(value = prompt) {
    const normalized = value.trim();
    if (!normalized) return;
    setPrompt("");
    setSubmittedPrompt(normalized);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setState("open")}
        aria-label="Открыть рабочего помощника"
        aria-pressed={state !== "closed"}
        title="Рабочий помощник"
        className={`focus-ring grid size-10 place-items-center rounded-[13px] transition-colors ${state !== "closed" ? "border border-[var(--line-strong)] bg-[var(--text)] text-[var(--canvas)]" : "soft-button text-[var(--muted)] hover:text-[var(--text)]"}`}
      >
        <Sparkles className="size-[18px]" strokeWidth={1.7} />
      </button>

      {state === "minimized" ? (
        <div data-testid="workspace-assistant-minimized" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-3 z-[60] flex h-12 items-center overflow-hidden rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-raised)] md:bottom-5 md:right-5">
          <button type="button" onClick={() => setState("open")} className="focus-ring flex h-full items-center gap-2.5 px-3.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-soft)]">
            <Sparkles className="size-4 text-[var(--accent-ink)]" />
            Помощник
          </button>
          <button type="button" onClick={() => setState("closed")} aria-label="Закрыть помощника" className="focus-ring grid h-full w-11 place-items-center border-l border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {state === "open" ? (
        <aside
          data-testid="workspace-assistant-window"
          aria-label="Рабочий помощник CRM"
          className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-3 right-3 z-[60] flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface-raised)] md:bottom-5 md:left-auto md:right-5 ${expanded ? "md:h-[calc(100dvh-6rem)] md:w-[min(44rem,calc(100vw-7rem))]" : "h-[min(35rem,calc(100dvh-6rem))] md:w-[26rem]"}`}
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--text)] text-[var(--canvas)]">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Рабочий помощник</p>
              <h2 className="mt-0.5 truncate text-sm font-semibold text-[var(--text)]">Навигация по CRM</h2>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setState("minimized")} aria-label="Свернуть помощника" title="Свернуть" className="focus-ring grid size-9 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
                <Minus className="size-4" />
              </button>
              <button type="button" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Уменьшить окно" : "Расширить окно"} title={expanded ? "Уменьшить" : "Расширить"} className="focus-ring hidden size-9 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)] md:grid">
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <button type="button" onClick={() => setState("closed")} aria-label="Закрыть помощника" title="Закрыть" className="focus-ring grid size-9 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4">
              <p className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">Текущий экран</p>
              <p className="mt-1 truncate text-xs font-medium text-[var(--text-secondary)]">{pathname}</p>
            </div>
            <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">
              Опишите рабочую задачу. Помощник подберёт нужный раздел, а окно можно оставить открытым или свернуть во время работы на сайте.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {quickPrompts.map((value) => (
                <button key={value} type="button" onClick={() => submit(value)} className="focus-ring rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[10px] text-[var(--text-secondary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]">
                  {value}
                </button>
              ))}
            </div>

            {submittedPrompt ? (
              <section className="mt-6 border-t border-[var(--line)] pt-5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Последний запрос</p>
                <p className="mt-2 text-sm leading-6 text-[var(--text)]">{submittedPrompt}</p>
                {destination ? (
                  <Link href={destination.href} className="focus-ring mt-4 flex items-center justify-between rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-soft)]">
                    <span>
                      <span className="block text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">Подходящий раздел</span>
                      <span className="mt-1 block">{destination.label}</span>
                    </span>
                    <ArrowRight className="size-4 text-[var(--muted)]" />
                  </Link>
                ) : (
                  <p className="mt-4 rounded-[12px] bg-[var(--surface-inset)] p-3 text-xs leading-5 text-[var(--muted)]">
                    Уточните, что нужно открыть: заказ, документ, мастер, выезд, задача или финансы.
                  </p>
                )}
              </section>
            ) : null}
          </div>

          <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="shrink-0 border-t border-[var(--line)] p-3 sm:p-4">
            <label className="flex items-end gap-2 rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-2">
              <span className="sr-only">Запрос помощнику</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} maxLength={500} placeholder="Например: покажи просроченные задачи" className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-xs leading-5 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" />
              <button type="submit" aria-label="Отправить запрос" className="focus-ring grid size-10 shrink-0 place-items-center rounded-[11px] bg-[var(--text)] text-[var(--canvas)] disabled:opacity-40" disabled={!prompt.trim()}>
                <ArrowUp className="size-4" />
              </button>
            </label>
          </form>
        </aside>
      ) : null}
    </>
  );
}
