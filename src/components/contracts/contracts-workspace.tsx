"use client";

import {
  CalendarClock,
  CalendarRange,
  ChevronRight,
  FileSignature,
  History,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ContractDialogs,
  NewContractButton,
  type ContractDialogMode,
} from "@/components/contracts/contract-dialogs";
import { Dialog } from "@/components/ui/dialog";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { matchesSearchText } from "@/lib/search-normalization";
import type {
  ContractListItem,
  ContractSnapshot,
  ContractStatus,
} from "@/server/contracts/types";

type QuickFilter = "all" | "active" | "expiring" | "scheduled";
type ScheduleFilter = "all" | "scheduled" | "unscheduled";
type ExpiryFilter = "all" | "attention" | "expired";
type ContractSort = "expiry-asc" | "expiry-desc" | "newest" | "oldest";
type AdvancedFilters = {
  status: "all" | ContractStatus;
  schedule: ScheduleFilter;
  expiry: ExpiryFilter;
  dateFrom: string;
  dateTo: string;
  master: string;
  sort: ContractSort;
};

const defaultAdvancedFilters: AdvancedFilters = {
  status: "all",
  schedule: "all",
  expiry: "all",
  dateFrom: "",
  dateTo: "",
  master: "",
  sort: "expiry-asc",
};
const statuses: Array<{ value: "all" | ContractStatus; label: string }> = [
  { value: "all", label: "Любой статус" },
  { value: "active", label: "Действует" },
  { value: "draft", label: "Черновик" },
  { value: "suspended", label: "Приостановлен" },
  { value: "completed", label: "Завершён" },
  { value: "cancelled", label: "Отменён" },
];
const quickFilters: Array<{ value: QuickFilter; label: string }> =
  [
    { value: "all", label: "Все договоры" },
    { value: "active", label: "Действуют" },
    { value: "expiring", label: "Требуют продления" },
    {
      value: "scheduled",
      label: "С плановыми выездами",
    },
  ];
const statusPresentation = {
  draft: {
    label: "Черновик",
    className:
      "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--text-secondary)]",
  },
  active: {
    label: "Действует",
    className:
      "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  },
  suspended: {
    label: "Приостановлен",
    className:
      "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  },
  completed: {
    label: "Завершён",
    className:
      "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  },
  cancelled: {
    label: "Отменён",
    className:
      "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]",
  },
} as const;

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
function formatDateTime(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(date));
}
function frequencyLabel(contract: ContractListItem) {
  if (!contract.schedule) return "Без графика";
  return `Каждые ${contract.schedule.frequencyInterval} ${contract.schedule.frequencyUnit === "month" ? "мес." : "нед."} · ${contract.schedule.localTime}`;
}
function expiryLabel(contract: ContractListItem) {
  if (contract.daysUntilEnd < 0) return `Истёк ${formatDate(contract.endsOn)}`;
  if (contract.daysUntilEnd === 0) return "Истекает сегодня";
  if (contract.daysUntilEnd <= contract.renewalNoticeDays)
    return `До окончания ${contract.daysUntilEnd} дн.`;
  return `До ${formatDate(contract.endsOn)}`;
}
function activeAdvancedFilterCount(filters: AdvancedFilters) {
  return [
    filters.status !== "all",
    filters.schedule !== "all",
    filters.expiry !== "all",
    Boolean(filters.dateFrom),
    Boolean(filters.dateTo),
    Boolean(filters.master),
    filters.sort !== "expiry-asc",
  ].filter(Boolean).length;
}
function FilterChoice<T extends string>({
  value,
  current,
  label,
  onChange,
}: {
  value: T;
  current: T;
  label: string;
  onChange: (value: T) => void;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onChange(value)}
      className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
    >
      {label}
    </button>
  );
}

export function ContractsWorkspace({
  snapshot,
  canWrite,
}: {
  snapshot: ContractSnapshot;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState(defaultAdvancedFilters);
  const [draft, setDraft] = useState(defaultAdvancedFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<ContractDialogMode>(null);
  const selected =
    snapshot.contracts.find((contract) => contract.id === selectedId) ?? null;
  const masters = useMemo(
    () =>
      Array.from(
        new Set(
          snapshot.contracts.flatMap((contract) =>
            contract.schedule?.defaultMasterName
              ? [contract.schedule.defaultMasterName]
              : [],
          ),
        ),
      ).sort((a, b) => a.localeCompare(b, "ru")),
    [snapshot.contracts],
  );
  const counts: Record<QuickFilter, number> = {
    all: snapshot.summary.total,
    active: snapshot.summary.active,
    expiring: snapshot.summary.expiring,
    scheduled: snapshot.contracts.filter((contract) => contract.schedule)
      .length,
  };
  const visible = useMemo(() => {
    const dateFrom = parseDateInput(advanced.dateFrom);
    const dateTo = parseDateInput(advanced.dateTo);
    const filtered = snapshot.contracts.filter((contract) => {
      if (quickFilter === "active" && contract.status !== "active")
        return false;
      if (
        quickFilter === "expiring" &&
        !(
          contract.daysUntilEnd >= 0 &&
          contract.daysUntilEnd <= contract.renewalNoticeDays
        )
      )
        return false;
      if (quickFilter === "scheduled" && !contract.schedule) return false;
      if (advanced.status !== "all" && contract.status !== advanced.status)
        return false;
      if (advanced.schedule === "scheduled" && !contract.schedule) return false;
      if (advanced.schedule === "unscheduled" && contract.schedule)
        return false;
      if (
        advanced.expiry === "attention" &&
        !(
          contract.daysUntilEnd >= 0 &&
          contract.daysUntilEnd <= contract.renewalNoticeDays
        )
      )
        return false;
      if (advanced.expiry === "expired" && contract.daysUntilEnd >= 0)
        return false;
      if (dateFrom && contract.endsOn < dateFrom) return false;
      if (dateTo && contract.endsOn > dateTo) return false;
      if (
        advanced.master &&
        contract.schedule?.defaultMasterName !== advanced.master
      )
        return false;
      return matchesSearchText(query, [
        contract.contractNumber,
        contract.clientName,
        contract.objectName,
        contract.objectAddress,
        contract.schedule?.defaultMasterName,
      ]);
    });
    return filtered.toSorted((left, right) => {
      if (advanced.sort === "expiry-desc")
        return right.endsOn.localeCompare(left.endsOn);
      if (advanced.sort === "newest")
        return right.startsOn.localeCompare(left.startsOn);
      if (advanced.sort === "oldest")
        return left.startsOn.localeCompare(right.startsOn);
      return left.endsOn.localeCompare(right.endsOn);
    });
  }, [advanced, query, quickFilter, snapshot.contracts]);

  function open(
    contract: ContractListItem,
    mode: Exclude<ContractDialogMode, "create" | null>,
  ) {
    setSelectedId(contract.id);
    setDialogMode(mode);
  }
  function close() {
    setDialogMode(null);
    setSelectedId(null);
  }
  function openAdvancedFilters() {
    setDraft(advanced);
    setFilterError(null);
    setAdvancedOpen(true);
  }
  function applyAdvancedFilters() {
    const from = draft.dateFrom ? parseDateInput(draft.dateFrom) : null;
    const to = draft.dateTo ? parseDateInput(draft.dateTo) : null;
    if ((draft.dateFrom && !from) || (draft.dateTo && !to)) {
      setFilterError("Введите дату полностью в формате ДД.ММ.ГГГГ.");
      return;
    }
    if (from && to && from > to) {
      setFilterError("Начальная дата не может быть позже конечной.");
      return;
    }
    setAdvanced(draft);
    setAdvancedOpen(false);
  }
  function resetFilters() {
    setQuery("");
    setQuickFilter("all");
    setAdvanced(defaultAdvancedFilters);
    setDraft(defaultAdvancedFilters);
    setFilterError(null);
  }

  const advancedCount = activeAdvancedFilterCount(advanced);
  const totalFilterCount =
    advancedCount + (quickFilter === "all" ? 0 : 1) + (query.trim() ? 1 : 0);

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] space-y-4">
      <section
        aria-label="Быстрые фильтры договоров"
        className="surface-panel scrollbar-hidden flex gap-1 overflow-x-auto p-2"
      >
        {quickFilters.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setQuickFilter(entry.value)}
            aria-pressed={quickFilter === entry.value}
            className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-xs transition-colors ${quickFilter === entry.value ? "border-[var(--line-strong)] bg-[var(--text)] text-[var(--canvas)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
          >
            {entry.label}
            <span
              className={`font-display text-[9px] ${quickFilter === entry.value ? "text-[var(--canvas)]/65" : "text-[var(--muted-subtle)]"}`}
            >
              {counts[entry.value]}
            </span>
          </button>
        ))}
      </section>

      <section className="surface-panel overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-[var(--line)] p-3 sm:p-4 lg:flex-row lg:items-center">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 lg:max-w-md">
            <Search className="size-4 shrink-0 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Номер, клиент, объект, адрес или мастер"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={openAdvancedFilters}
              className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-[12px] border px-3 text-xs ${advancedCount ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)]"}`}
            >
              <SlidersHorizontal className="size-4" />
              Фильтры
              {advancedCount ? (
                <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">
                  {advancedCount}
                </span>
              ) : null}
            </button>
            {totalFilterCount ? (
              <button
                type="button"
                onClick={resetFilters}
                className="focus-ring flex h-11 shrink-0 items-center gap-2 rounded-[12px] border border-[var(--line)] px-3 text-xs text-[var(--text-secondary)]"
              >
                <RotateCcw className="size-3.5" />
                Сбросить
              </button>
            ) : null}
            <span className="ml-auto shrink-0 text-[10px] text-[var(--muted)]">
              {visible.length} из {snapshot.contracts.length}
              {totalFilterCount
                ? ` · ${totalFilterCount} активных условий`
                : ""}
            </span>
          </div>
          {canWrite ? (
            <NewContractButton onClick={() => setDialogMode("create")} />
          ) : null}
        </header>

        <div className="hidden min-w-[68rem] grid-cols-[minmax(12rem,1.2fr)_minmax(15rem,1.8fr)_9rem_10rem_11rem_8rem] items-center gap-4 border-b border-[var(--line)] px-5 py-3 text-[9px] uppercase tracking-[0.1em] text-[var(--muted)] lg:grid">
          <span>Договор</span>
          <span>Клиент / объект</span>
          <span>Период</span>
          <span>График</span>
          <span>Следующий выезд</span>
          <span className="text-right">Действия</span>
        </div>
        <div>
          {visible.map((contract) => {
            const presentation = statusPresentation[contract.status];
            return (
              <article
                key={contract.id}
                onClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      "a, button, input, select, textarea",
                    )
                  ) {
                    router.push(`/contracts/${contract.id}`);
                  }
                }}
                className="cursor-pointer border-b border-[var(--line)] p-4 transition-colors last:border-0 hover:bg-[var(--surface-soft)] lg:grid lg:min-w-[68rem] lg:grid-cols-[minmax(12rem,1.2fr)_minmax(15rem,1.8fr)_9rem_10rem_11rem_8rem] lg:items-center lg:gap-4 lg:px-5 lg:py-4"
              >
                <div className="flex items-start justify-between gap-3 lg:block">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/contracts/${contract.id}`}
                        className="focus-ring rounded text-sm font-semibold text-[var(--text)]"
                      >
                        {contract.contractNumber}
                      </Link>
                      <span
                        className={`rounded-[7px] border px-2 py-1 text-[9px] ${presentation.className}`}
                      >
                        {presentation.label}
                      </span>
                    </div>
                    <p
                      className={`mt-2 text-[10px] ${contract.daysUntilEnd >= 0 && contract.daysUntilEnd <= contract.renewalNoticeDays ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}
                    >
                      {expiryLabel(contract)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => open(contract, "history")}
                    aria-label={`История договора ${contract.contractNumber}`}
                    className="focus-ring grid size-9 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)] lg:hidden"
                  >
                    <History className="size-4" />
                  </button>
                </div>
                <div className="mt-4 min-w-0 lg:mt-0">
                  <p className="truncate text-xs font-medium text-[var(--text)]">
                    {contract.clientName}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-[var(--text-secondary)]">
                    {contract.objectName} · {contract.objectAddress}
                  </p>
                  {contract.renewedFromContractId ? (
                    <p className="mt-1 text-[9px] text-[var(--support)]">
                      Продление предыдущего периода
                    </p>
                  ) : null}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:mt-0 lg:block">
                  <div>
                    <p className="text-[9px] text-[var(--muted)] lg:hidden">
                      Начало
                    </p>
                    <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                      {formatDate(contract.startsOn)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-[var(--muted)] lg:hidden">
                      Окончание
                    </p>
                    <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                      {formatDate(contract.endsOn)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 lg:mt-0">
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    {frequencyLabel(contract)}
                  </p>
                  <p className="mt-1 text-[9px] text-[var(--muted)]">
                    {contract.schedule
                      ? `${contract.schedule.visitCount} дат${contract.schedule.defaultMasterName ? ` · ${contract.schedule.defaultMasterName}` : ""}`
                      : "Можно добавить при продлении"}
                  </p>
                </div>
                <div className="mt-4 lg:mt-0">
                  {contract.nextVisitAt ? (
                    <Link
                      href="/calendar"
                      className="focus-ring inline-flex items-center gap-2 rounded text-[10px] text-[var(--success)] hover:text-[var(--support-strong)]"
                    >
                      <CalendarClock className="size-3.5" />
                      {formatDateTime(contract.nextVisitAt)}
                    </Link>
                  ) : (
                    <span className="text-[10px] text-[var(--muted)]">
                      Не запланирован
                    </span>
                  )}
                </div>
                <div className="mt-4 flex justify-end gap-1.5 lg:mt-0">
                  <button
                    type="button"
                    onClick={() => open(contract, "history")}
                    aria-label={`История договора ${contract.contractNumber}`}
                    title="История"
                    className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                  >
                    <History className="size-3.5" />
                  </button>
                  {canWrite ? (
                    <>
                      <button
                        type="button"
                        onClick={() => open(contract, "edit")}
                        aria-label={`Редактировать договор ${contract.contractNumber}`}
                        title="Редактировать"
                        className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {!contract.renewedByContractId &&
                      !["draft", "cancelled"].includes(contract.status) ? (
                        <button
                          type="button"
                          onClick={() => open(contract, "renew")}
                          aria-label={`Продлить договор ${contract.contractNumber}`}
                          title="Продлить"
                          className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                      ) : contract.renewedByContractId ? (
                        <span
                          title="Продление создано"
                          className="grid size-9 place-items-center text-[var(--success)]"
                        >
                          <ChevronRight className="size-4" />
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        {!visible.length ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <FileSignature className="mx-auto size-8 text-[var(--muted-subtle)]" />
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                Договоры не найдены
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Измените условия или сбросьте фильтры.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="focus-ring mt-4 rounded-[10px] bg-[var(--surface-soft)] px-3 py-2 text-xs text-[var(--text)]"
              >
                Сбросить фильтры
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <Dialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="Фильтры договоров"
        description="Отберите периоды по статусу, сроку действия, графику и ответственному мастеру."
      >
        <div className="space-y-7 p-5 sm:p-7">
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Статус
            </legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {statuses.map((option) => (
                <FilterChoice
                  key={option.value}
                  value={option.value}
                  current={draft.status}
                  label={option.label}
                  onChange={(status) =>
                    setDraft((current) => ({ ...current, status }))
                  }
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Плановый график
            </legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              <FilterChoice
                value="all"
                current={draft.schedule}
                label="Любой"
                onChange={(schedule) =>
                  setDraft((current) => ({ ...current, schedule }))
                }
              />
              <FilterChoice
                value="scheduled"
                current={draft.schedule}
                label="Есть график"
                onChange={(schedule) =>
                  setDraft((current) => ({ ...current, schedule }))
                }
              />
              <FilterChoice
                value="unscheduled"
                current={draft.schedule}
                label="Без графика"
                onChange={(schedule) =>
                  setDraft((current) => ({ ...current, schedule }))
                }
              />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Срок действия
            </legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              <FilterChoice
                value="all"
                current={draft.expiry}
                label="Любой"
                onChange={(expiry) =>
                  setDraft((current) => ({ ...current, expiry }))
                }
              />
              <FilterChoice
                value="attention"
                current={draft.expiry}
                label="Нужно продлить"
                onChange={(expiry) =>
                  setDraft((current) => ({ ...current, expiry }))
                }
              />
              <FilterChoice
                value="expired"
                current={draft.expiry}
                label="Уже истёк"
                onChange={(expiry) =>
                  setDraft((current) => ({ ...current, expiry }))
                }
              />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              <CalendarRange className="size-3.5" />
              Дата окончания
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-2 block text-[10px] text-[var(--text-secondary)]">
                  С даты
                </span>
                <input
                  inputMode="numeric"
                  value={draft.dateFrom}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dateFrom: formatDateInput(event.target.value),
                    }))
                  }
                  placeholder="ДД.ММ.ГГГГ"
                  className="h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]"
                />
              </label>
              <label>
                <span className="mb-2 block text-[10px] text-[var(--text-secondary)]">
                  По дату
                </span>
                <input
                  inputMode="numeric"
                  value={draft.dateTo}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dateTo: formatDateInput(event.target.value),
                    }))
                  }
                  placeholder="ДД.ММ.ГГГГ"
                  className="h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]"
                />
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Ответственный мастер
            </legend>
            <div
              className="max-h-48 space-y-1 overflow-y-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-1.5"
              role="radiogroup"
            >
              <FilterChoice
                value=""
                current={draft.master}
                label="Любой мастер"
                onChange={(master) =>
                  setDraft((current) => ({ ...current, master }))
                }
              />
              {masters.map((master) => (
                <FilterChoice
                  key={master}
                  value={master}
                  current={draft.master}
                  label={master}
                  onChange={(selectedMaster) =>
                    setDraft((current) => ({
                      ...current,
                      master: selectedMaster,
                    }))
                  }
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Сортировка
            </legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              <FilterChoice
                value="expiry-asc"
                current={draft.sort}
                label="Сначала истекающие"
                onChange={(sort) =>
                  setDraft((current) => ({ ...current, sort }))
                }
              />
              <FilterChoice
                value="expiry-desc"
                current={draft.sort}
                label="Сначала дальние"
                onChange={(sort) =>
                  setDraft((current) => ({ ...current, sort }))
                }
              />
              <FilterChoice
                value="newest"
                current={draft.sort}
                label="Сначала новые периоды"
                onChange={(sort) =>
                  setDraft((current) => ({ ...current, sort }))
                }
              />
              <FilterChoice
                value="oldest"
                current={draft.sort}
                label="Сначала старые периоды"
                onChange={(sort) =>
                  setDraft((current) => ({ ...current, sort }))
                }
              />
            </div>
          </fieldset>
          {filterError ? (
            <p
              role="alert"
              className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]"
            >
              {filterError}
            </p>
          ) : null}
        </div>
        <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <button
            type="button"
            onClick={() => {
              setDraft(defaultAdvancedFilters);
              setFilterError(null);
            }}
            className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)]"
          >
            <RotateCcw className="mr-2 inline size-3.5" />
            Очистить
          </button>
          <button
            type="button"
            onClick={applyAdvancedFilters}
            className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]"
          >
            Показать договоры
          </button>
        </footer>
      </Dialog>
      <ContractDialogs
        mode={dialogMode}
        contract={selected}
        objectOptions={snapshot.objectOptions}
        masterOptions={snapshot.masterOptions}
        onClose={close}
      />
    </div>
  );
}
