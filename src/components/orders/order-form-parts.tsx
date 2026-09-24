"use client";

import { Check, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OrderMutationState } from "@/app/(workspace)/orders/actions";
import type { OrderPickerQuery, OrderPickerResult } from "@/lib/order-picker";
import { filterPickerOptions } from "@/lib/picker-options";

export const orderInputClass =
  "focus-ring h-12 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] disabled:cursor-not-allowed disabled:opacity-45";
export const orderTextareaClass =
  "focus-ring min-h-24 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3.5 py-3 text-sm leading-5 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";

export function OrderField({
  label,
  required,
  errors,
  children,
}: {
  label: string;
  required?: boolean;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-[10px] text-[var(--muted)]">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {errors?.length ? (
        <span className="text-[var(--danger-ink)]">{errors[0]}</span>
      ) : null}
    </label>
  );
}

type PickerOption = { value: string; label: string; detail?: string };

export function OrderPicker({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  required,
  errors,
  placement,
  searchable = label === "Мастер",
  searchPlaceholder = label === "Мастер" ? "ФИО или телефон" : "Найти вариант",
  remote,
  onSelected,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  errors?: string[];
  placement?: "top" | "bottom";
  searchable?: boolean;
  searchPlaceholder?: string;
  remote?: { type: OrderPickerQuery["type"]; clientId?: string };
  onSelected?: (option: PickerOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [remoteOptions, setRemoteOptions] = useState<{ key: string; items: PickerOption[] } | null>(null);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedOption, setSelectedOption] = useState<PickerOption | null>(null);
  const remoteType = remote?.type ?? (label === "Мастер" && options.length > 20 ? "masters" : null);
  const remoteClientId = remote?.clientId;
  const remoteKey = `${remoteType ?? ""}:${remoteClientId ?? ""}:${query}`;
  useEffect(() => {
    if (!open || !remoteType || (remoteType === "objects" || remoteType === "contacts") && !remoteClientId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(false);
      const params = new URLSearchParams({ type: remoteType, q: query });
      if (remoteClientId) params.set("clientId", remoteClientId);
      try {
        const response = await fetch(`/api/v1/orders/options?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Order picker request failed");
        const payload = await response.json() as { data: OrderPickerResult };
        if (!controller.signal.aborted) {
          setRemoteOptions({ key: remoteKey, items: payload.data.items.map((item) => ({ value: item.id, label: item.name, detail: item.detail })) });
          setRemoteHasMore(payload.data.hasMore);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, remoteClientId, remoteType, remoteKey, retry]);
  const selected = options.find((option) => option.value === value) ?? (selectedOption?.value === value ? selectedOption : null);
  const visibleOptions = useMemo(
    () => {
      if (!remoteType) return searchable ? filterPickerOptions(options, query) : options;
      if (remoteOptions?.key !== remoteKey) return query ? [] : options;
      const empty = options.find((option) => option.value === "");
      return empty ? [empty, ...remoteOptions.items] : remoteOptions.items;
    },
    [options, query, remoteOptions, remoteKey, remoteType, searchable],
  );
  const menuPosition =
    (placement ?? (label === "Контакт" ? "top" : "bottom")) === "top"
      ? "bottom-[3.25rem]"
      : "top-[3.25rem]";
  return (
    <div className="grid gap-2 text-[10px] text-[var(--muted)]">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <details
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (!event.currentTarget.open) setQuery("");
        }}
        className="group relative open:z-[90]"
      >
        <summary
          aria-label={label}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          className={`focus-ring flex h-12 list-none items-center justify-between gap-3 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3.5 text-left text-sm [&::-webkit-details-marker]:hidden ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
        >
          <span
            className={
              selected
                ? "truncate text-[var(--text)]"
                : "truncate text-[var(--muted-subtle)]"
            }
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        {!disabled ? (
          <div
            className={`absolute left-0 right-0 z-50 max-h-[min(20rem,52dvh)] overflow-y-auto rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5 shadow-[0_16px_35px_rgba(0,0,0,0.14)] ${menuPosition}`}
          >
            {searchable ? (
              <label className="sticky top-0 z-10 mb-1.5 flex h-11 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 shadow-sm">
                <Search className="size-3.5 shrink-0 text-[var(--accent)]" />
                <span className="sr-only">Поиск: {label}</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={100}
                  onKeyDown={(event) => {
                    if (event.key === "Escape")
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    event.stopPropagation();
                  }}
                  placeholder={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Очистить поиск"
                    className="focus-ring grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </label>
            ) : null}
            {visibleOptions.length ? (
              visibleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={(event) => {
                    onChange(option.value);
                    onSelected?.(option);
                    setSelectedOption(option);
                    setQuery("");
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  className={`focus-ring block w-full rounded-[10px] px-3 py-2.5 text-left ${option.value === value ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
                >
                  <span className="block text-xs">{option.label}</span>
                  {option.detail ? (
                    <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                      {option.detail}
                    </span>
                  ) : null}
                </button>
              ))
            ) : (
              <p className="px-3 py-5 text-center text-xs text-[var(--muted)]">
                {loading || (Boolean(query) && remoteType && remoteOptions?.key !== remoteKey) ? "Загрузка…" : loadError ? "Не удалось загрузить варианты" : "Поиск не дал результатов"}
              </p>
            )}
            {remoteType && loadError ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="focus-ring w-full rounded-[10px] px-3 py-2 text-xs text-[var(--accent)]">Повторить</button> : null}
            {remoteType && !loading && !loadError && remoteHasMore ? <p className="px-3 py-2 text-[10px] text-[var(--muted)]">Показаны первые 20. Уточните поиск.</p> : null}
          </div>
        ) : null}
      </details>
      {errors?.length ? (
        <span className="text-[var(--danger-ink)]">{errors[0]}</span>
      ) : null}
    </div>
  );
}

export function OrderFormStatus({
  state,
}: {
  state: Pick<OrderMutationState, "status" | "message">;
}) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)]/45 bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)]/45 bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}
    >
      {state.status === "success" ? (
        <Check className="mr-2 inline size-4" />
      ) : null}
      {state.message}
    </p>
  );
}

export function OrderFormFooter({
  pending,
  saved,
  onCancel,
  submitLabel,
  disabled,
}: {
  pending: boolean;
  saved: boolean;
  onCancel: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <footer className="mt-auto flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line-strong)] text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
      >
        Отмена
      </button>
      <button
        type="submit"
        disabled={pending || saved || disabled}
        className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Сохраняем…
          </>
        ) : saved ? (
          <>
            <Check className="size-4" />
            Сохранено
          </>
        ) : (
          submitLabel
        )}
      </button>
    </footer>
  );
}
