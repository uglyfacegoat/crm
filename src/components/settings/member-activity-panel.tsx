"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, Clock3, Monitor, Search, UsersRound } from "lucide-react";
import { activityReportSchema, type ActivityReport } from "@/lib/member-activity-report";
import { screenLabels, type ScreenKey } from "@/lib/member-activity";
import type { MemberActivity } from "@/server/members/activity";
import type { MemberActivityAccount } from "@/server/members/types";

const roleLabels = {
  owner: "Владелец", developer: "Разработчик", deputy: "Заместитель", finance_controller: "Финконтроль", sales_lead: "Руководитель продаж", sales_specialist: "Менеджер продаж", regional_director: "Региональный директор", crm_coordinator: "Координатор CRM", tender_specialist: "Тендерный отдел", foreman: "Бригадир", admin: "Администратор", dispatcher: "Диспетчер",
  manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер",
} as const;

function duration(seconds: number) {
  if (!seconds) return "0 мин";
  if (seconds < 60) return "<1 мин";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  return `${(seconds / 3600).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч`;
}

function dayKey(offset: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).toLocaleDateString("sv-SE");
}

function dayLabel(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

type Row = {
  member: MemberActivityAccount;
  seconds: number;
  demoSeconds: number;
  activeDays: number;
  screens: { key: ScreenKey; seconds: number }[];
  daily: Map<string, number>;
  lastActivityAt: string | null;
};

export function MemberActivityPanel({ members, activity, preview = false }: { members: MemberActivityAccount[]; activity: MemberActivity[]; preview?: boolean }) {
  const [period, setPeriod] = useState<7 | 30>(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [report, setReport] = useState<{ data: ActivityReport; key: string; listKey: string } | null>(null);
  const [error, setError] = useState("");
  const listKey = JSON.stringify({ period, search, page });
  const queryKey = JSON.stringify({ period, search, page, selectedId });
  const currentReport = report?.key === queryKey ? report.data : null;
  const listReport = report?.listKey === listKey ? report.data : null;
  const listBusy = !preview && !listReport && !error;
  const busy = !preview && !currentReport && !error;
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ period: String(period), page: String(page), q: search });
        if (selectedId) params.set("memberId", selectedId);
        const response = await fetch(`/api/v1/settings/activity?${params}`, { signal: controller.signal, credentials: "same-origin", cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Не удалось загрузить отчёт. Повторите запрос.");
        const data = activityReportSchema.parse(body.data);
        if (active) setReport({ data, key: queryKey, listKey });
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить отчёт.");
      }
    }, search ? 220 : 0);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [preview, period, search, page, selectedId, retry, queryKey, listKey]);
  const localDays = useMemo(() => Array.from({ length: period }, (_, index) => dayKey(period - index - 1)), [period]);
  const days = !preview && report?.data.period === period ? report.data.days.map(day => day.date) : localDays;
  const firstDay = localDays[0];
  const localRows = useMemo(() => {
    const byMember = new Map(activity.map((item) => [item.memberId, item]));
    return members.map((member): Row => {
      const source = byMember.get(member.id);
      const screens = new Map<ScreenKey, number>();
      const daily = new Map<string, number>();
      let seconds = 0;
      let demoSeconds = 0;
      for (const bucket of source?.buckets ?? []) {
        if (bucket.date < firstDay) continue;
        seconds += bucket.seconds;
        if (bucket.source === "demo") demoSeconds += bucket.seconds;
        screens.set(bucket.key, (screens.get(bucket.key) ?? 0) + bucket.seconds);
        daily.set(bucket.date, (daily.get(bucket.date) ?? 0) + bucket.seconds);
      }
      return {
        member, seconds, demoSeconds, activeDays: daily.size, daily,
        screens: [...screens].map(([key, value]) => ({ key, seconds: value })).sort((a, b) => b.seconds - a.seconds),
        lastActivityAt: source?.lastActivityAt ?? null,
      };
    }).sort((a, b) => b.seconds - a.seconds || a.member.displayName.localeCompare(b.member.displayName, "ru"));
  }, [activity, firstDay, members]);
  const filteredRows = preview ? localRows.filter(({ member }) => `${member.displayName} ${member.email} ${roleLabels[member.role]}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))) : listReport?.members.items ?? [];
  const detail = currentReport?.selected;
  const selected: Row | undefined = preview ? localRows.find(({ member }) => member.id === selectedId) ?? localRows[0]
    : detail ? { ...detail, daily: new Map(detail.daily.map(day => [day.date, day.seconds])) } : undefined;
  const summary = !preview && report?.data.period === period ? report.data.summary : null;
  const totalSeconds = preview ? localRows.reduce((sum, row) => sum + row.seconds, 0) : summary?.totalSeconds ?? 0;
  const activeCount = preview ? localRows.filter(row => row.seconds > 0).length : summary?.activeCount ?? 0;
  const demoSeconds = preview ? localRows.reduce((sum, row) => sum + row.demoSeconds, 0) : summary?.demoSeconds ?? 0;
  const chart = !preview && report?.data.period === period ? report.data.days : days.map(date => ({ date, seconds: localRows.reduce((sum, row) => sum + (row.daily.get(date) ?? 0), 0) }));
  const memberCount = preview ? members.length : summary?.memberCount ?? 0;
  const listTotal = preview ? filteredRows.length : listReport?.members.total ?? 0;
  const pageSize = listReport?.members.pageSize ?? 30;
  const pages = Math.max(1, Math.ceil(listTotal / pageSize));
  const chartMax = Math.max(1, ...chart.map((day) => day.seconds));
  const screenMax = Math.max(1, ...(selected?.screens.map((screen) => screen.seconds) ?? []));
  const personalMax = Math.max(1, ...(selected ? days.map((date) => selected.daily.get(date) ?? 0) : []));

  return <div className="mt-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="eyebrow">Команда / активность</p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--text)]">Отчёт по пользователям</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">Время в открытой вкладке CRM с фокусом, пока нет бездействия дольше пяти минут. Показатель приблизительный.</p>
      </div>
      <div className="inline-flex rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1" role="group" aria-label="Период отчёта">
        {([7, 30] as const).map((value) => <button key={value} type="button" onClick={() => { setPeriod(value); setPage(1); setError(""); }} aria-pressed={period === value}
          className={`focus-ring min-h-9 rounded-lg px-4 text-xs font-medium ${period === value ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)]"}`}>{value} дней</button>)}
      </div>
    </div>

    {demoSeconds ? <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
      В отчёте есть демонстрационные записи: {duration(demoSeconds)}. Они добавлены для просмотра интерфейса и не отражают реальную работу сотрудников.
    </div> : null}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Сотрудников", value: String(memberCount), icon: UsersRound },
        { label: "Были активны", value: String(activeCount), icon: Activity },
        { label: "Время в CRM", value: duration(totalSeconds), icon: Clock3 },
        { label: "В среднем на активного", value: duration(activeCount ? totalSeconds / activeCount : 0), icon: Monitor },
      ].map(({ label, value, icon: Icon }) => <div key={label} className="surface-panel flex min-h-24 items-center gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-soft)]"><Icon className="size-5" /></span>
        <div><p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
          <p className="mt-1 font-display text-xl font-semibold text-[var(--text)]">{!preview && !summary ? "—" : value}</p></div>
      </div>)}
    </div>

    <section className="surface-panel p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h3 className="font-display text-lg font-semibold text-[var(--text)]">Динамика команды</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Суммарное время по дням · {period} дней</p></div>
        <span className="text-xs text-[var(--muted)]">Всего {duration(totalSeconds)}</span>
      </div>
      <div className="mt-6">
        <div className="flex h-44 items-end gap-0.5 border-b border-[var(--line)] pb-1 sm:gap-1.5">
          {chart.map((day) => <div key={day.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${dayLabel(day.date)} · ${duration(day.seconds)}`}>
            <div className={`w-full rounded-t-sm ${day.seconds ? "bg-[var(--accent)]" : "bg-[var(--surface-soft)]"}`}
              style={{ height: `${day.seconds ? Math.max(4, day.seconds / chartMax * 100) : 3}%` }} />
          </div>)}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]">
          <span>{dayLabel(days[0])}</span><span>{dayLabel(days[Math.floor(days.length / 2)])}</span><span>{dayLabel(days[days.length - 1])}</span>
        </div>
      </div>
    </section>

    <section className="surface-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] p-5 sm:p-6">
        <div><h3 className="font-display text-lg font-semibold text-[var(--text)]">Сотрудники и экраны</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Выберите сотрудника, чтобы увидеть его распределение времени.</p></div>
        <label className="relative block w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input value={search} maxLength={100} onChange={(event) => { setSearch(event.currentTarget.value); setPage(1); setSelectedId(null); setError(""); }} placeholder="Найти сотрудника"
            aria-label="Найти сотрудника" className="focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pl-9 pr-3 text-xs" />
        </label>
      </div>
      <div className="grid lg:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.3fr)]">
        <div aria-label="Сотрудники отчёта" aria-busy={listBusy} className="max-h-[36rem] overflow-y-auto border-b border-[var(--line)] p-3 lg:border-b-0 lg:border-r">
          {filteredRows.length ? filteredRows.map((row, index) => <button key={row.member.id} type="button" disabled={listBusy} onClick={() => { setSelectedId(row.member.id); setError(""); }}
            aria-pressed={(selectedId ?? selected?.member.id) === row.member.id}
            className={`focus-ring mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${(selectedId ?? selected?.member.id) === row.member.id ? "bg-[var(--surface-soft)]" : "hover:bg-[var(--surface-soft)]"}`}>
            <span className="w-6 shrink-0 text-[10px] text-[var(--muted)]">{String((page - 1) * pageSize + index + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--text)]">{row.member.displayName}</span>
              <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">{roleLabels[row.member.role]} · {row.activeDays} дн. активности</span></span>
            <span className="shrink-0 text-xs font-semibold text-[var(--text)]">{duration(row.seconds)}</span>
          </button>) : <p className="p-4 text-xs text-[var(--muted)]">{busy ? "Загрузка отчёта…" : error ? "Список временно недоступен." : "Сотрудники не найдены."}</p>}
        </div>
        <div className="min-w-0 p-5 sm:p-6">
          {selected ? <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Карточка активности</p>
            <h4 className="mt-2 font-display text-xl font-semibold text-[var(--text)]">{selected.member.displayName}</h4>
            <p className="mt-1 break-all text-xs text-[var(--muted)]">{selected.member.email} · {roleLabels[selected.member.role]}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[var(--surface-soft)] p-3"><p className="text-[10px] text-[var(--muted)]">Время за период</p><p className="mt-1 font-display text-lg font-semibold">{duration(selected.seconds)}</p></div>
              <div className="rounded-xl bg-[var(--surface-soft)] p-3"><p className="text-[10px] text-[var(--muted)]">Дней активности</p><p className="mt-1 font-display text-lg font-semibold">{selected.activeDays}</p></div>
            </div>
            <p className="mt-4 flex items-center gap-2 text-[11px] text-[var(--muted)]"><CalendarDays className="size-3.5" />
              {selected.lastActivityAt ? `Последняя активность: ${new Date(selected.lastActivityAt).toLocaleString("ru-RU", { timeZone: currentReport?.timeZone ?? "Europe/Moscow" })}` : "Активность пока не записана"}</p>
            {selected.demoSeconds ? <p className="mt-2 text-[11px] text-[var(--muted)]">Из них демо: {duration(selected.demoSeconds)}</p> : null}
            <div className="mt-6">
              <div className="flex justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"><span>Динамика сотрудника</span><span>{period} дней</span></div>
              <div className="mt-3 flex h-16 items-end gap-1">{days.map((date) => <div key={date} className={`min-w-0 flex-1 rounded-t-sm ${selected.daily.get(date) ? "bg-[var(--accent)]" : "bg-[var(--surface-soft)]"}`}
                style={{ height: `${selected.daily.get(date) ? Math.max(5, (selected.daily.get(date) ?? 0) / personalMax * 100) : 3}%` }} title={`${dayLabel(date)} · ${duration(selected.daily.get(date) ?? 0)}`} />)}</div>
            </div>
            <div className="mt-7">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">По экранам</p>
              {selected.screens.length ? <div className="mt-4 space-y-4">{selected.screens.map((screen) => <div key={screen.key}>
                <div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="text-[var(--text)]">{screenLabels[screen.key]}</span>
                  <span className="font-medium text-[var(--text)]">{duration(screen.seconds)} · {Math.round(screen.seconds / selected.seconds * 100)}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-soft)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${screen.seconds / screenMax * 100}%` }} /></div>
              </div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-5 text-xs text-[var(--muted)]">Данных за выбранный период пока нет.</div>}
            </div>
          </> : <p className="text-xs text-[var(--muted)]">{busy ? "Загрузка карточки…" : error ? "Не удалось загрузить карточку." : "Выберите сотрудника из списка."}</p>}
        </div>
      </div>
    </section>
    {error ? <div role="alert" className="rounded-xl border border-[var(--line)] p-4 text-xs"><p>{error}</p><button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }} className="focus-ring mt-2 rounded-lg border border-[var(--line)] px-3 py-2">Повторить загрузку отчёта</button></div> : null}
    {!preview ? <div aria-label="Страницы активности" className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
      <p role="status">{busy ? "Загрузка отчёта…" : `Найдено: ${listTotal} · Страница ${page} из ${pages}`}</p>
      <div className="flex gap-2"><button type="button" disabled={busy || page <= 1} onClick={() => { setPage(value => value - 1); setSelectedId(null); setError(""); }} className="focus-ring rounded-xl border border-[var(--line)] px-4 py-2 disabled:opacity-40">Назад</button><button type="button" disabled={busy || Boolean(error) || page >= pages} onClick={() => { setPage(value => value + 1); setSelectedId(null); }} className="focus-ring rounded-xl border border-[var(--line)] px-4 py-2 disabled:opacity-40">Далее</button></div>
    </div> : null}
    <p className="text-[11px] leading-5 text-[var(--muted)]">История собирается с момента включения учёта. Несколько вкладок одного сотрудника не увеличивают время сверх одного интервала; это обзор присутствия в интерфейсе, а не табель рабочего времени.</p>
  </div>;
}
