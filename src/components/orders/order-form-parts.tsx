"use client";

import { Check, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { OrderMutationState } from "@/app/(workspace)/orders/actions";
import { ORDER_PICKER_PAGE_SIZE, type OrderPickerQuery, type OrderPickerResult } from "@/lib/order-picker";
import { focusPickerOption } from "@/lib/picker-keyboard";
import { FloatingLayer } from "@/components/ui/floating-layer";
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

type PickerOption = { value: string; label: string; detail?: string; clientId?: string; areaSquareMeters?: string | null; catalogItem?: NonNullable<OrderPickerResult["items"][number]["catalogItem"]> };

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
  searchable = true,
  hideLabel = false,
  searchPlaceholder = label === "Мастер" ? "ФИО или телефон" : "Найти вариант",
  remote,
  remoteUrl,
  pinnedValues,
  onSelected,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string, option?: PickerOption) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  errors?: string[];
  placement?: "top" | "bottom";
  searchable?: boolean;
  hideLabel?: boolean;
  searchPlaceholder?: string;
  remote?: { type: OrderPickerQuery["type"]; clientId?: string };
  remoteUrl?: string;
  pinnedValues?: string[];
  onSelected?: (option: PickerOption) => void;
}) {
  const selectionId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [remoteOptions, setRemoteOptions] = useState<{ key: string; items: PickerOption[] } | null>(null);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedOption, setSelectedOption] = useState<PickerOption | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const remoteType = remote?.type ?? (label === "Мастер" && options.length > 20 ? "masters" : null);
  const remoteClientId = remote?.clientId;
  const remoteKey = `${remoteType ?? ""}:${remoteUrl ?? ""}:${remoteClientId ?? ""}:${query}`;
  useEffect(() => {
    if (!open || (!remoteType && !remoteUrl) || (remoteType === "objects" || remoteType === "contacts") && !remoteClientId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(false);
      const url = new URL(remoteUrl ?? "/api/v1/orders/options", window.location.origin);
      if (remoteType) url.searchParams.set("type", remoteType);
      url.searchParams.set("q", query);
      if (remoteClientId) url.searchParams.set("clientId", remoteClientId);
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Order picker request failed");
        const payload = await response.json() as { data: OrderPickerResult };
        if (!controller.signal.aborted) {
          setRemoteOptions({ key: remoteKey, items: payload.data.items.map((item) => ({ value: item.id, label: item.name, detail: item.detail, clientId: item.clientId, areaSquareMeters: item.areaSquareMeters, catalogItem: item.catalogItem })) });
          setRemoteHasMore(payload.data.hasMore);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, remoteClientId, remoteType, remoteUrl, remoteKey, retry]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target)) {
        detailsRef.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);
  const selected = options.find((option) => option.value === value) ?? (selectedOption?.value === value ? selectedOption : null);
  const visibleOptions = useMemo(
    () => {
      if ((!remoteType && !remoteUrl) || loadError) return searchable ? filterPickerOptions(options, query) : options;
      const pinned = options.filter((option) => option.value === "" || option.value === value || pinnedValues?.includes(option.value));
      if (selectedOption?.value === value && !pinned.some((option) => option.value === value)) pinned.push(selectedOption);
      if (remoteOptions?.key !== remoteKey) return query ? [] : [...pinned, ...options.slice(0, ORDER_PICKER_PAGE_SIZE).filter((option) => !pinned.some((item) => item.value === option.value))];
      return [...pinned, ...remoteOptions.items.filter((option) => !pinned.some((item) => item.value === option.value))];
    },
    [options, query, remoteOptions, remoteKey, remoteType, remoteUrl, searchable, loadError, pinnedValues, selectedOption, value],
  );
  return (
    <div className="grid gap-2 text-[10px] text-[var(--muted)]">
      <span className={hideLabel ? "sr-only" : undefined}>
        {label}
        {required ? " *" : ""}
      </span>
      <details
        ref={detailsRef}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (!event.currentTarget.open) setQuery("");
        }}
        onKeyDown={(event) => {
          if (!event.currentTarget.open) return;
          if (focusPickerOption(detailsRef.current, event.key)) { event.preventDefault(); event.stopPropagation(); return; }
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.removeAttribute("open");
          event.currentTarget.querySelector("summary")?.focus();
        }}
        className="group relative open:z-[90]"
      >
        <summary
          aria-label={label}
          aria-describedby={selectionId}
          aria-expanded={open}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          className={`focus-ring flex h-12 list-none items-center justify-between gap-3 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3.5 text-left text-sm [&::-webkit-details-marker]:hidden ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
        >
          <span
            id={selectionId}
            className={
              selected
                ? "truncate text-[var(--text)]"
                : "truncate text-[var(--muted-subtle)]"
            }
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </summary>
        {open && !disabled ? (
          <FloatingLayer anchorRef={detailsRef} anchorSelector=":scope > summary" placement={placement ?? (label === "Контакт" ? "top" : "bottom")}
            className="rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5 shadow-[0_16px_35px_rgba(0,0,0,0.14)]"
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
                    if (event.key === "Enter" || focusPickerOption(detailsRef.current, event.key)) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      detailsRef.current?.removeAttribute("open");
                      detailsRef.current?.querySelector("summary")?.focus();
                    }
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
            {(remoteType || remoteUrl) && loadError ? <div role="status" className="rounded-[10px] border border-[var(--line)] p-3 text-xs text-[var(--muted)]">
              <p>Не удалось обновить список. Повторите запрос.</p>
              <button type="button" onClick={() => setRetry(value => value + 1)} className="focus-ring mt-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[var(--accent)]">Повторить</button>
            </div> : null}
            {visibleOptions.length ? (
              visibleOptions.map((option) => (
                <button
                  key={option.value}
                  data-picker-option
                  type="button"
                  onClick={(event) => {
                    onChange(option.value, option);
                    onSelected?.(option);
                    setSelectedOption(option);
                    setQuery("");
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    detailsRef.current?.querySelector("summary")?.focus();
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
                {loadError ? "Нет совпадений среди загруженных вариантов." : loading || (Boolean(query) && (remoteType || remoteUrl) && remoteOptions?.key !== remoteKey) ? "Загрузка…" : "Поиск не дал результатов"}
              </p>
            )}
            {(remoteType || remoteUrl) && !loading && !loadError && remoteHasMore ? <p className="px-3 py-2 text-[10px] text-[var(--muted)]">Показаны первые 20. Уточните поиск.</p> : null}
          </FloatingLayer>
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
