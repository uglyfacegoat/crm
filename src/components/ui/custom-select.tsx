"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
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
  disabled = false,
  className = "",
}: {
  name?: string;
  value: string;
  options: readonly CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useDismissableLayer(rootRef, open, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !listboxRef.current) return;
    const trigger = rootRef.current.getBoundingClientRect();
    const menuHeight = Math.min(listboxRef.current.scrollHeight, 256) + 8;
    const roomBelow = window.innerHeight - trigger.bottom;
    const roomAbove = trigger.top;
    setOpenUpwards(roomBelow < menuHeight && roomAbove > roomBelow);
  }, [open, options.length]);

  function moveSelection(direction: 1 | -1) {
    const enabled = options.filter((option) => !option.disabled);
    const currentIndex = enabled.findIndex((option) => option.value === value);
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + enabled.length) % enabled.length;
    if (enabled[nextIndex]) onChange(enabled[nextIndex].value);
  }

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 ${open ? "z-[90]" : "z-0"}`}
    >
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
            setOpen(true);
          }
        }}
        className={`focus-ring flex w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="min-w-0 truncate">
          {selected?.label ?? "Выберите значение"}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute inset-x-0 z-[100] max-h-64 overflow-y-auto rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.24)] ${openUpwards ? "bottom-[calc(100%+0.4rem)]" : "top-[calc(100%+0.4rem)]"}`}
        >
          {options.map((option) => (
            <button
              key={option.value || "empty"}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`focus-ring flex min-h-10 w-full items-center justify-between gap-3 rounded-[10px] px-3 text-left text-xs transition-colors disabled:opacity-40 ${option.value === value ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === value ? (
                <Check className="size-3.5 shrink-0" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
