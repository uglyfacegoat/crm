"use client";

import type { LucideIcon } from "lucide-react";
import { useRef } from "react";

export type SegmentedTab<Value extends string> = {
  value: Value;
  label: string;
  icon?: LucideIcon;
};

export function SegmentedTabs<Value extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className = "",
}: {
  tabs: readonly SegmentedTab<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  label: string;
  idPrefix: string;
  className?: string;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectFromKeyboard(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.value);
    buttonRefs.current[index]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`scrollbar-hidden flex max-w-full gap-1 overflow-x-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-1 ${className}`}
    >
      {tabs.map((tab, index) => {
        const active = value === tab.value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            id={`${idPrefix}-${tab.value}-tab`}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel`}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => {
              if (event.key === "Home") {
                event.preventDefault();
                selectFromKeyboard(0);
              } else if (event.key === "End") {
                event.preventDefault();
                selectFromKeyboard(tabs.length - 1);
              } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const offset = event.key === "ArrowRight" ? 1 : -1;
                selectFromKeyboard((index + offset + tabs.length) % tabs.length);
              }
            }}
            className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-xs transition-colors ${active ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
          >
            {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
