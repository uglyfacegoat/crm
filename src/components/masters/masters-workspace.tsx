"use client";

import {
  ArrowUpRight,
  ChevronDown,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatMoneyMinor, getInitials } from "@/lib/format";
import { matchesSearchText } from "@/lib/search-normalization";
import type { MasterListItem, MasterStatusCode } from "@/server/masters/types";

const statusStyle: Record<MasterStatusCode, string> = {
  scheduled:
    "border-[var(--support)]/40 bg-[var(--support-soft)] text-[var(--support-strong)]",
  available:
    "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  overloaded:
    "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  vacation:
    "border-[var(--line-strong)] bg-[var(--surface-inset)] text-[var(--text-secondary)]",
  unavailable:
    "border-[var(--line-strong)] bg-[var(--surface-inset)] text-[var(--text-secondary)]",
  terminated:
    "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]",
};

const statusFilters: Array<{ value: "all" | MasterStatusCode; label: string }> =
  [
    { value: "all", label: "Все" },
    { value: "scheduled", label: "С выездами" },
    { value: "available", label: "Свободны" },
    { value: "overloaded", label: "Перегружены" },
    { value: "vacation", label: "В отпуске" },
    { value: "unavailable", label: "Не работают" },
    { value: "terminated", label: "Уволены" },
  ];

function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label={`Фильтр: ${label}`}
        className="focus-ring flex h-10 min-w-32 cursor-pointer list-none items-center justify-between gap-3 rounded-[11px] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] [&::-webkit-details-marker]:hidden"
      >
        <span className="max-w-36 truncate">{value || label}</span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 text-[var(--muted)] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="absolute right-0 top-12 z-30 min-w-48 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-panel)]">
        {["", ...options].map((option) => (
          <button
            key={option || "all"}
            type="button"
            onClick={(event) => {
              onChange(option);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
            className={`focus-ring block w-full rounded-[8px] px-3 py-2 text-left text-xs ${value === option ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
          >
            {option || `Все: ${label.toLocaleLowerCase("ru")}`}
          </button>
        ))}
      </div>
    </details>
  );
}

function visitTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

function loadTone(master: MasterListItem) {
  if (master.statusCode === "overloaded" || master.loadPercent > 100)
    return "bg-[var(--danger)]";
  if (master.statusCode === "available") return "bg-[var(--support)]";
  return "bg-[var(--accent)]";
}

function MasterRosterRow({
  master,
  index,
  onOpen,
}: {
  master: MasterListItem;
  index: number;
  onOpen: (masterId: string) => void;
}) {
  const visits = master.todayVisits.slice(0, 2);

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`Открыть карточку мастера ${master.fullName}`}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a, button"))
          onOpen(master.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(master.id);
        }
      }}
      className="group relative grid min-w-0 cursor-pointer gap-5 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-5 transition-colors last:border-b-0 hover:bg-[var(--surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] focus-visible:outline-offset-[-2px] md:grid-cols-[2.5rem_minmax(13rem,1.15fr)_minmax(11rem,0.8fr)_minmax(13rem,1fr)_7rem_1.5rem] md:items-center sm:px-5"
    >
      <span className="hidden font-display text-[10px] tabular-nums text-[var(--muted-subtle)] md:block">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface-inset)] font-display text-xs font-medium text-[var(--text)]">
            {getInitials(master.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--text)]">
              {master.fullName}
            </h2>
            <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-[var(--muted)]">
              <MapPin className="size-3 shrink-0" />
              {master.serviceRegion} · {master.serviceZone}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-medium ${statusStyle[master.statusCode]}`}
              >
                {master.statusLabel}
              </span>
              {master.skills.slice(0, 2).map((skill) => (
                <span key={skill} className="text-[9px] text-[var(--muted)]">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 pl-14 text-[10px] text-[var(--text-secondary)]">
          <a
            href={`tel:${master.phone}`}
            className="focus-ring flex items-center gap-1.5 rounded-sm hover:text-[var(--accent-ink)]"
          >
            <Phone className="size-3" />
            {master.phone}
          </a>
          {master.messenger ? (
            <span className="flex items-center gap-1.5">
              <MessageCircle className="size-3" />
              {master.messenger}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
          Загрузка
        </p>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <strong className="font-display text-base font-medium text-[var(--text)]">
            {master.todayVisitCount}
            <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">
              из {master.dailyCapacity}
            </span>
          </strong>
          <span className="text-[10px] tabular-nums text-[var(--text-secondary)]">
            {master.loadPercent}%
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
          <div
            className={`h-full rounded-full ${loadTone(master)}`}
            style={{ width: `${Math.min(master.loadPercent, 100)}%` }}
          />
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
          Маршрут сегодня
        </p>
        {visits.length ? (
          <div className="mt-2 grid gap-1">
            {visits.map((visit) => (
              <Link
                key={visit.id}
                href={`/orders/${visit.orderId}`}
                className="focus-ring grid min-w-0 grid-cols-[3.1rem_minmax(0,1fr)] gap-2 rounded-[7px] py-0.5 text-[10px] leading-4 text-[var(--text-secondary)] hover:text-[var(--accent-ink)]"
              >
                <span className="font-display tabular-nums text-[var(--accent-ink)]">
                  {visitTime(visit.scheduledStartAt, visit.timezone)}
                </span>
                <span className="truncate">
                  №{visit.orderNumber} · {visit.clientName}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-[var(--muted)]">Свободное окно</p>
        )}
      </div>

      <div className="md:text-right">
        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
          Ставка
        </p>
        <strong className="mt-1 block font-display text-xs font-medium text-[var(--text)]">
          {master.basePaymentMinor === undefined
            ? "Скрыто"
            : master.basePaymentMinor === null
              ? "Не указана"
              : formatMoneyMinor(master.basePaymentMinor)}
        </strong>
      </div>
      <ArrowUpRight
        aria-hidden
        className="hidden size-4 shrink-0 text-[var(--muted)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)] md:block"
      />
    </article>
  );
}

export function MastersWorkspace({ masters }: { masters: MasterListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | MasterStatusCode>("all");
  const [region, setRegion] = useState("");
  const [zone, setZone] = useState("");
  const [skill, setSkill] = useState("");

  const facets = useMemo(
    () => ({
      regions: Array.from(
        new Set(masters.map((master) => master.serviceRegion)),
      ).sort((a, b) => a.localeCompare(b, "ru")),
      zones: Array.from(
        new Set(
          masters
            .filter((master) => !region || master.serviceRegion === region)
            .map((master) => master.serviceZone),
        ),
      ).sort((a, b) => a.localeCompare(b, "ru")),
      skills: Array.from(
        new Set(masters.flatMap((master) => master.skills)),
      ).sort((a, b) => a.localeCompare(b, "ru")),
    }),
    [masters, region],
  );
  const counts = useMemo(
    () =>
      new Map(
        statusFilters.map((entry) => [
          entry.value,
          entry.value === "all"
            ? masters.length
            : masters.filter((master) => master.statusCode === entry.value)
                .length,
        ]),
      ),
    [masters],
  );
  const filtered = useMemo(() => {
    return masters.filter((master) => {
      if (status !== "all" && master.statusCode !== status) return false;
      if (region && master.serviceRegion !== region) return false;
      if (zone && master.serviceZone !== zone) return false;
      if (skill && !master.skills.includes(skill)) return false;
      return matchesSearchText(query, [
        master.fullName,
        master.phone,
        master.messenger,
        master.serviceRegion,
        master.serviceZone,
        ...master.skills,
      ]);
    });
  }, [masters, query, region, skill, status, zone]);
  const filtersActive = Boolean(
    query || status !== "all" || region || zone || skill,
  );

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setRegion("");
    setZone("");
    setSkill("");
  }

  return (
    <div className="mt-[clamp(1.2rem,0.9rem+0.7vw,2rem)]">
      <section
        aria-label="Фильтры мастеров"
        className="surface-panel surface-panel-popover p-2"
      >
        <div className="flex gap-1 overflow-x-auto rounded-[13px] bg-[var(--surface-inset)] p-1">
          {statusFilters.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setStatus(entry.value)}
              aria-pressed={status === entry.value}
              className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-xs transition-colors ${status === entry.value ? "border-[var(--line-strong)] bg-[var(--text)] text-[var(--canvas)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
            >
              {entry.label}
              <span
                className={`text-[10px] tabular-nums ${status === entry.value ? "text-[var(--canvas)]/65" : "text-[var(--muted-subtle)]"}`}
              >
                {counts.get(entry.value) ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 px-1 pb-1 pt-3">
          <label className="focus-within:border-[var(--accent)]/55 flex h-10 min-w-52 flex-1 items-center gap-2 rounded-[11px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 transition-colors">
            <Search className="size-4 shrink-0 text-[var(--muted)]" />
            <span className="sr-only">Поиск мастеров</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ФИО, телефон, регион, зона…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          <FilterMenu
            label="Регион"
            value={region}
            options={facets.regions}
            onChange={(value) => {
              setRegion(value);
              setZone("");
            }}
          />
          <FilterMenu
            label="Зона"
            value={zone}
            options={facets.zones}
            onChange={setZone}
          />
          <FilterMenu
            label="Специализация"
            value={skill}
            options={facets.skills}
            onChange={setSkill}
          />
          {filtersActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="focus-ring h-10 rounded-[11px] px-3 text-xs text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-soft)]"
            >
              Сбросить
            </button>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 px-2 pb-1 pt-4">
        <p className="text-sm text-[var(--text-secondary)]">
          <strong className="font-display font-medium text-[var(--text)]">
            {filtered.length}
          </strong>{" "}
          из {masters.length} специалистов
        </p>
        <p className="text-[10px] text-[var(--muted)]">
          <span className="text-[var(--support-strong)]">
            Свободны: {counts.get("available") ?? 0}
          </span>
          <span className="mx-2 text-[var(--line-strong)]">·</span>На выездах:{" "}
          {counts.get("scheduled") ?? 0}
          <span className="mx-2 text-[var(--line-strong)]">·</span>
          <span className="text-[var(--warning)]">
            Перегружены: {counts.get("overloaded") ?? 0}
          </span>
        </p>
      </div>

      {filtered.length ? (
        <section
          aria-label="Реестр мастеров"
          className="surface-panel mt-4 min-w-0 overflow-hidden"
        >
          <header className="hidden grid-cols-[2.5rem_minmax(13rem,1.15fr)_minmax(11rem,0.8fr)_minmax(13rem,1fr)_7rem_1.5rem] gap-5 border-b border-[var(--line)] bg-[var(--surface-inset)] px-5 py-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:grid">
            <span>№</span>
            <span>Специалист</span>
            <span>Загрузка</span>
            <span>Ближайший маршрут</span>
            <span className="text-right">Ставка</span>
            <span />
          </header>
          {filtered.map((master, index) => (
            <MasterRosterRow
              key={master.id}
              master={master}
              index={index}
              onOpen={(masterId) => router.push(`/masters/${masterId}`)}
            />
          ))}
        </section>
      ) : (
        <section className="grid min-h-52 place-items-center border-b border-[var(--line)] py-8 text-center">
          <div>
            <UsersRound className="mx-auto size-8 text-[var(--muted)]" />
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              Мастера не найдены
            </p>
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              Измените поиск или фильтры.
            </p>
            {filtersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className="focus-ring mt-4 rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
              >
                Сбросить фильтры
              </button>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
