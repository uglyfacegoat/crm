"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { FloatingLayer } from "./floating-layer";
import { focusPickerOption } from "@/lib/picker-keyboard";
import { matchesSearchText } from "@/lib/search-normalization";
import { useDismissableLayer } from "@/components/ui/use-dismissable-layer";

export type CustomSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function CustomSelect({
  name,
  value,
  options,
  onChange,
  ariaLabel,
  searchable = true,
  disabled = false,
  className = "",
}: {
  name?: string;
  value: string;
  options: readonly CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const initialFocusKey = useRef<"ArrowDown" | "ArrowUp" | null>(null);
  const listboxId = useId();
  const selectionId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useDismissableLayer(rootRef, open, () => { setOpen(false); setQuery(""); });
  const visibleOptions = searchable ? options.filter((option) => matchesSearchText(query, [option.label])) : options;
  useLayoutEffect(() => {
    if (!open || !initialFocusKey.current) return;
    const key = initialFocusKey.current;
    initialFocusKey.current = null;
    focusPickerOption(rootRef.current, key);
  }, [open]);

  return (
    <div
      ref={rootRef}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery("");
          rootRef.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus(); return;
        }
        if (open && event.target instanceof HTMLButtonElement && event.target.hasAttribute("data-picker-option") && focusPickerOption(rootRef.current, event.key)) {
          event.preventDefault(); event.stopPropagation();
        }
      }}
      className={`relative min-w-0 ${open ? "z-[90]" : "z-0"}`}
    >
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={selectionId}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        onClick={() => { setQuery(""); setOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setQuery("");
            if (open) focusPickerOption(rootRef.current, event.key);
            else { initialFocusKey.current = event.key; setOpen(true); }
          }
        }}
        className={`focus-ring flex w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span id={selectionId} className="min-w-0 truncate">
          {selected?.label ?? "Выберите значение"}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <FloatingLayer
          anchorRef={rootRef} anchorSelector=":scope > button" maxHeight={440}
          className="rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.24)]"
        >
          {searchable ? <label className="sticky top-0 z-10 mb-1.5 flex h-11 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 shadow-sm">
            <Search className="size-3.5 shrink-0 text-[var(--accent)]" />
            <span className="sr-only">Поиск: {ariaLabel}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100}
              placeholder="Найти вариант" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" || focusPickerOption(rootRef.current, event.key)) { event.preventDefault(); event.stopPropagation(); }
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(""); rootRef.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus(); }
              }} />
          </label> : null}
          <div id={listboxId} role="listbox" aria-label={ariaLabel}>
          {visibleOptions.map((option) => (
            <button
              key={option.value || "empty"}
              data-picker-option
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                setQuery("");
                rootRef.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus();
              }}
              className={`focus-ring flex min-h-10 w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-xs leading-5 transition-colors disabled:opacity-40 ${option.value === value ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
            >
              <span className="min-w-0 whitespace-normal break-words">{option.label}</span>
              {option.value === value ? (
                <Check className="size-3.5 shrink-0" />
              ) : null}
            </button>
          ))}
          {!visibleOptions.length ? <p className="px-3 py-5 text-center text-xs text-[var(--muted)]">Поиск не дал результатов</p> : null}
          </div>
        </FloatingLayer>
      ) : null}
    </div>
  );
}
