"use client";

import {
  MapPin,
  MessageCircle,
  Phone,
  Search,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrderPicker } from "@/components/orders/order-form-parts";
import { masterVisitHref } from "@/lib/master-visit";
import type { MasterListPage } from "@/lib/master-list";
import { formatMoneyMinor } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
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
  return <div className="w-44 min-w-0"><OrderPicker label={`Фильтр: ${label}`} hideLabel value={value} onChange={onChange}
    options={[{ value: "", label: `Все: ${label.toLocaleLowerCase("ru")}` }, ...options.map(option => ({ value: option, label: option }))]}
    placeholder={label} searchPlaceholder={`Найти: ${label.toLocaleLowerCase("ru")}`} /></div>;
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
}: {
  master: MasterListItem;
  index: number;
}) {
  const router = useRouter();
  const visits = master.todayVisits.slice(0, 2);
  const href = `/masters/${master.id}`;

  return (
    <article role="link" tabIndex={0} aria-label={`Открыть карточку мастера ${master.fullName}`} onClick={(event) => { if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) return; router.push(href); }} onKeyDown={(event) => { if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); router.push(href); }} className="relative grid min-w-0 cursor-pointer gap-5 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-5 transition-colors last:border-b-0 hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] xl:grid-cols-[2.5rem_minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,1fr)_7rem] xl:items-center sm:px-5">
      <span className="hidden font-display text-[10px] tabular-nums text-[var(--muted-subtle)] xl:block">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3">
          <Avatar name={master.fullName} size="md" tone="violet" className="row-span-2 !size-11 self-center border border-[var(--line-strong)]"
            src={`/api/v1/masters/${master.id}/avatar`} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--text)]">
              <Link href={`/masters/${master.id}`} aria-label={`Открыть карточку мастера ${master.fullName}`} className="focus-ring rounded hover:text-[var(--accent-ink)]">
                {master.fullName}
              </Link>
            </h2>
            <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-[var(--muted)]">
              <MapPin className="size-3 shrink-0" />
              {master.serviceRegion} · {master.serviceZone}
            </p>
            {master.organizationName ? <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{master.organizationName}</p> : null}
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
        <div className="col-start-2 mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-[var(--text-secondary)]">
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
                href={masterVisitHref(visit)}
                className="focus-ring grid min-w-0 grid-cols-[3.1rem_minmax(0,1fr)] gap-2 rounded-[7px] py-0.5 text-[10px] leading-4 text-[var(--text-secondary)] hover:text-[var(--accent-ink)]"
              >
                <span className="font-display tabular-nums text-[var(--accent-ink)]">
                  {visitTime(visit.scheduledStartAt, visit.timezone)}
                </span>
                <span className="truncate">
                  {visit.orderNumber ? `№${visit.orderNumber}` : "По договору"} · {visit.clientName}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-[var(--muted)]">Свободное окно</p>
        )}
      </div>

      <div className="xl:text-right">
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
    </article>
  );
}

export function MastersWorkspace({ masters, initialPage }: { masters: MasterListItem[]; initialPage: MasterListPage | null }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | MasterStatusCode>("all");
  const [region, setRegion] = useState("");
  const [zone, setZone] = useState("");
  const [skill, setSkill] = useState("");

  const localFacets = useMemo(
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
  const localCounts = useMemo(
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
  const localFiltered = useMemo(() => {
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
  const [page, setPage] = useState(1);
  const [remotePage, setRemotePage] = useState(initialPage);
  const [loadedKey, setLoadedKey] = useState("");
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const firstFetch = useRef(true);
  const requestKey = new URLSearchParams({ q: query, status, region, zone, skill, page: String(page) }).toString();
  const initialKey = "q=&status=all&region=&zone=&skill=&page=1";
  const validRemote = remotePage && (loadedKey === requestKey || (!loadedKey && requestKey === initialKey));
  useEffect(() => {
    if (!initialPage) return;
    if (firstFetch.current) { firstFetch.current = false; return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingKey(requestKey); setErrorKey(null);
      try {
        const response = await fetch(`/api/v1/masters?${requestKey}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Master list unavailable");
        const payload = await response.json() as { data: MasterListPage };
        if (!controller.signal.aborted) { setRemotePage(payload.data); setLoadedKey(requestKey); }
      } catch { if (!controller.signal.aborted) setErrorKey(requestKey); }
      finally { if (!controller.signal.aborted) setLoadingKey(null); }
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [initialPage, requestKey, retry, query]);
  const facets = remotePage?.facets ?? localFacets;
  const counts = initialPage ? new Map(Object.entries(remotePage?.counts ?? {})) : localCounts;
  const filtered = initialPage ? validRemote ? remotePage!.items : [] : localFiltered;
  const filtersActive = Boolean(
    query || status !== "all" || region || zone || skill,
  );

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setRegion("");
    setZone("");
    setSkill(""); setPage(1);
  }

  return (
    <div className="mt-[clamp(1.2rem,0.9rem+0.7vw,2rem)]">
      <section
        aria-label="Фильтры мастеров"
        className="surface-panel surface-panel-popover p-2"
      >
        <div className="flex gap-1 overflow-x-auto">
          {statusFilters.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => { setStatus(entry.value); setPage(1); }}
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
              maxLength={100}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
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
              setZone(""); setPage(1);
            }}
          />
          <FilterMenu
            label="Зона"
            value={zone}
            options={facets.zones}
            onChange={(value) => { setZone(value); setPage(1); }}
          />
          <FilterMenu
            label="Специализация"
            value={skill}
            options={facets.skills}
            onChange={(value) => { setSkill(value); setPage(1); }}
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
            {initialPage ? validRemote ? remotePage!.total : "…" : filtered.length}
          </strong>{" "}
          из {counts.get("all") ?? masters.length} специалистов
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
          className="surface-panel panel-stack mt-4 min-w-0 overflow-hidden"
        >
          <header className="hidden grid-cols-[2.5rem_minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,1fr)_7rem] gap-5 border-b border-[var(--line)] bg-[var(--surface-inset)] px-5 py-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] xl:grid">
            <span>№</span>
            <span>Специалист</span>
            <span>Загрузка</span>
            <span>Ближайший маршрут</span>
            <span className="text-right">Ставка</span>
          </header>
          {filtered.map((master, index) => (
            <MasterRosterRow key={master.id} master={master} index={index + (initialPage ? ((remotePage?.page ?? 1) - 1) * (remotePage?.pageSize ?? 50) : 0)} />
          ))}
        </section>
      ) : initialPage && !validRemote ? <div role="status" className="py-10 text-center text-sm text-[var(--muted)]">
        {errorKey === requestKey ? <><p>Не удалось загрузить мастеров.</p><button className="focus-ring mt-3 underline" type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></> : "Загрузка мастеров…"}
      </div> : (
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
      {initialPage && validRemote && remotePage!.total > remotePage!.pageSize ? <nav aria-label="Страницы мастеров" className="mt-4 flex items-center justify-between gap-2 text-xs">
        <button type="button" disabled={remotePage!.page <= 1 || loadingKey === requestKey} onClick={() => setPage(remotePage!.page - 1)} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-40">Назад</button>
        <span>Страница {remotePage!.page} из {Math.ceil(remotePage!.total / remotePage!.pageSize)}</span>
        <button type="button" disabled={remotePage!.page * remotePage!.pageSize >= remotePage!.total || loadingKey === requestKey} onClick={() => setPage(remotePage!.page + 1)} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-40">Далее</button>
      </nav> : null}
    </div>
  );
}
