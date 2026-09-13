"use client";

import { ChartNoAxesCombined, CircleCheck, DatabaseZap, Globe2, Link2, RotateCcw, Search, SlidersHorizontal, UsersRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ConfigureIntegrationDialog, CreateWebsiteButton, type WebsiteIntegrationSelection } from "@/components/sites/site-dialogs";
import { providerLabels, SiteCard } from "@/components/sites/site-card";
import { SiteTrafficTrendChart } from "@/components/sites/site-traffic-trend-chart";
import { TrafficSourcesChart } from "@/components/sites/traffic-sources-chart";
import { Dialog } from "@/components/ui/dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { formatMoneyMinor } from "@/lib/format";
import { clientCrypto as crypto } from "@/lib/client-id";
import { matchesSearchText } from "@/lib/search-normalization";
import { websiteProviders, type WebsiteIntegrationStatus, type WebsiteListItem, type WebsiteProvider, type WebsiteSnapshot, type WebsiteStatus } from "@/server/sites/types";

type Filter = "all" | WebsiteStatus;
type IntegrationFilter = "all" | "none" | WebsiteIntegrationStatus;
type SiteSort = "visitors-desc" | "leads-desc" | "conversion-desc" | "name";
type SiteFilters = { provider: "all" | WebsiteProvider; integration: IntegrationFilter; minLeads: string; sort: SiteSort };

const filterOptions: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Все сайты" },
  { value: "active", label: "Активные" },
  { value: "setup", label: "Настройка" },
  { value: "attention", label: "Требуют внимания" },
  { value: "disabled", label: "Отключённые" },
];
const defaultFilters: SiteFilters = { provider: "all", integration: "all", minLeads: "", sort: "visitors-desc" };
const integerFormatter = new Intl.NumberFormat("ru-RU");

function SignalMetric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <div className="min-w-0 rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] p-3.5">
    <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{label}</span>
    <strong className="mt-2 block truncate font-display text-xl font-semibold tracking-[-0.04em]" style={{ color: tone }}>{value}</strong>
    <span className="mt-1 block truncate text-[9px] text-[var(--muted)]">{note}</span>
  </div>;
}

function FilterChoice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}>{label}</button>;
}

export function SitesWorkspace({ snapshot, canWrite, preview }: { snapshot: WebsiteSnapshot; canWrite: boolean; preview: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [integrationSelection, setIntegrationSelection] = useState<WebsiteIntegrationSelection | null>(null);
  const openIntegrationDialog = useCallback((site: WebsiteListItem) => setIntegrationSelection({ site, requestKey: crypto.randomUUID() }), []);
  const closeIntegrationDialog = useCallback(() => setIntegrationSelection(null), []);
  const sites = useMemo(() => {
    const minimumLeads = filters.minLeads ? Number(filters.minLeads) : null;
    const visible = snapshot.sites.filter((site) => {
      if (filter !== "all" && site.status !== filter) return false;
      if (filters.provider !== "all" && !site.integrations.some((integration) => integration.provider === filters.provider)) return false;
      if (filters.integration === "none" && site.integrations.length) return false;
      if (filters.integration !== "all" && filters.integration !== "none" && !site.integrations.some((integration) => integration.status === filters.integration)) return false;
      if (minimumLeads !== null && site.leads < minimumLeads) return false;
      return matchesSearchText(query, [site.name, site.domain]);
    });
    return visible.toSorted((left, right) => {
      if (filters.sort === "leads-desc") return right.leads - left.leads;
      if (filters.sort === "conversion-desc") return right.conversionPercent - left.conversionPercent;
      if (filters.sort === "name") return left.name.localeCompare(right.name, "ru");
      return right.visitors - left.visitors;
    });
  }, [filter, filters, query, snapshot.sites]);
  const activeFilterCount = [filters.provider !== "all", filters.integration !== "all", Boolean(filters.minLeads), filters.sort !== "visitors-desc"].filter(Boolean).length;

  function resetFilters() {
    setFilter("all");
    setQuery("");
    setFilters(defaultFilters);
    setDraftFilters(defaultFilters);
    setFilterError(null);
  }

  function applyFilters() {
    if (draftFilters.minLeads && (!/^\d+$/.test(draftFilters.minLeads) || Number(draftFilters.minLeads) > 1_000_000)) {
      setFilterError("Минимум заявок должен быть целым числом от 0 до 1 000 000.");
      return;
    }
    setFilters(draftFilters);
    setFiltersOpen(false);
  }

  return <div>
    <PageHeading eyebrow="Единый центр сайтов" title="Сайты и трафик" description={preview ? "Демонстрация будущей сквозной аналитики. В рабочем режиме показатели читаются из PostgreSQL." : `Реестр доменов, подключения и путь заявок до оплаченных заказов за ${snapshot.period.startDate} — ${snapshot.period.endDate}.`} action={<CreateWebsiteButton canWrite={canWrite} />} />

    <section aria-label="Сводка по сайтам" className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-[clamp(1rem,0.8rem+0.7vw,1.75rem)] shadow-[var(--shadow-panel)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-[var(--accent-soft)] text-[var(--accent)]"><Globe2 className="size-6" /></span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">Портфель доменов</p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-[-0.05em] text-[var(--text)]">{snapshot.summary.totalSites} <span className="text-sm font-normal text-[var(--muted)]">сайтов</span></p>
            <p className="mt-1 text-[10px] text-[var(--success)]">{snapshot.summary.activeSites} работают штатно</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[35rem]">
          <SignalMetric label="Аудитория" value={integerFormatter.format(snapshot.summary.visitors)} note={`${integerFormatter.format(snapshot.summary.pageviews)} просмотров`} tone="var(--text)" />
          <SignalMetric label="Заявки" value={integerFormatter.format(snapshot.summary.leads)} note={`${snapshot.summary.paidOrders} привели к оплате`} tone="var(--accent)" />
          <SignalMetric label="Конверсия" value={`${snapshot.summary.conversionPercent.toLocaleString("ru-RU")}%`} note={formatMoneyMinor(snapshot.summary.paidRevenueMinor)} tone="var(--support)" />
        </div>
      </div>
    </section>

    <div className="mt-4 flex flex-col gap-3 border-b border-[var(--line)] pb-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 gap-1 overflow-x-auto">
        {filterOptions.map((option) => <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={`focus-ring h-10 shrink-0 rounded-[10px] px-3 text-xs ${filter === option.value ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>{option.label}</button>)}
      </div>
      <div className="flex min-w-0 gap-2">
        <label className="relative block min-w-0 flex-1 xl:w-72 xl:flex-none">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[var(--muted)]" />
          <span className="sr-only">Поиск по сайтам</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или домен…" className="focus-ring h-10 w-full rounded-[11px] border border-[var(--line)] bg-[var(--surface-inset)] pl-9 pr-3 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" />
        </label>
        <button type="button" onClick={() => { setDraftFilters(filters); setFilterError(null); setFiltersOpen(true); }} className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[11px] border px-3 text-xs ${activeFilterCount ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"}`}><SlidersHorizontal className="size-4" />Фильтры{activeFilterCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">{activeFilterCount}</span> : null}</button>
        {query.trim() || filter !== "all" || activeFilterCount ? <button type="button" onClick={resetFilters} aria-label="Сбросить фильтры сайтов" className="focus-ring grid size-10 shrink-0 place-items-center rounded-[11px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"><RotateCcw className="size-3.5" /></button> : null}
      </div>
    </div>

    {sites.length ? <section aria-label="Подключённые сайты" className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4 2xl:gap-5">{sites.map((site, index) => <SiteCard key={site.id} site={site} index={index} onConfigure={openIntegrationDialog} canWrite={canWrite && !preview} />)}</section> : <section className="surface-panel mt-4 grid min-h-56 place-items-center p-8 text-center"><div><DatabaseZap className="mx-auto size-7 text-[var(--muted)]" /><h2 className="mt-3 text-sm font-medium text-[var(--text)]">{snapshot.sites.length ? "По фильтру ничего не найдено" : "Добавьте первый сайт"}</h2><p className="mt-2 text-[10px] text-[var(--muted)]">Рабочая аналитика появится после регистрации домена и подключения источника.</p></div></section>}

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)] 2xl:gap-5">
      <section className="surface-panel min-w-0 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]">
        <div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">30 дней · {integerFormatter.format(snapshot.summary.searchClicks)} поисковых кликов</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold text-[var(--text)]">Трафик без двойного счёта</h2></div><ChartNoAxesCombined className="size-5 text-[var(--muted)]" /></div>
        <SiteTrafficTrendChart {...snapshot.trafficTrend} emptyMessage="За период данных о трафике нет" />
      </section>
      <section className="surface-panel p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]"><div className="mb-4"><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">CRM-лиды</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold text-[var(--text)]">Источники заявок</h2></div><TrafficSourcesChart entries={snapshot.trafficSources} /></section>
    </div>

    <section className="surface-panel mt-4 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Интеграции</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold text-[var(--text)]">Источники аналитики</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">CRM хранит только property ID и ссылку на серверный секрет. Токены не попадают в HTML, Server Action или audit log.</p></div><span className="flex w-fit items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 text-[10px] text-[var(--text-secondary)]"><Link2 className="size-3.5" />OAuth worker — следующий этап</span></div>
      <div className="mt-6 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">{websiteProviders.map((provider) => {
        const integrations = snapshot.sites.flatMap((site) => site.integrations).filter((integration) => integration.provider === provider);
        const connected = integrations.filter((integration) => integration.status === "connected").length;
        return <article key={provider} className="min-w-0 rounded-[16px] border border-[var(--line)] bg-[var(--surface-raised)] p-4"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-[var(--surface-inset)]"><CircleCheck className={`size-3.5 ${connected ? "text-[var(--success)]" : "text-[var(--muted)]"}`} /></span><h3 className="truncate text-xs font-semibold text-[var(--text)]">{providerLabels[provider]}</h3></div><p className="mt-3 min-h-10 text-[10px] leading-5 text-[var(--muted)]">{provider === "yandex_metrica" || provider === "ga4" ? "Посетители, просмотры, события и цели" : "Клики, показы и поисковая видимость"}</p><span className="mt-4 inline-block rounded-full bg-[var(--surface-inset)] px-2 py-1 text-[9px] text-[var(--text-secondary)]">{integrations.length ? `${integrations.length} настроено · ${connected} активно` : "Не настроено"}</span></article>;
      })}</div>
      <div className="mt-4 flex items-start gap-3 rounded-[15px] border border-[var(--info-border)] bg-[var(--info-bg)] p-4"><UsersRound className="mt-0.5 size-4 shrink-0 text-[var(--info)]" /><p className="text-[11px] leading-5 text-[var(--info)]">Сквозная ценность считается по цепочке `сайт → заявка → заказ → оплата`. Посетители выбираются из одного канонического analytics-провайдера на дату, поэтому параллельные GA4 и Метрика не удваивают аудиторию.</p></div>
    </section>

    <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Фильтры сайтов" description="Отберите домены по источнику данных, состоянию интеграции и результативности.">
      <div className="space-y-7 p-5 sm:p-7">
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Источник данных</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="all" current={draftFilters.provider} label="Любой источник" onChange={(provider) => setDraftFilters((current) => ({ ...current, provider }))} />{websiteProviders.map((provider) => <FilterChoice key={provider} value={provider} current={draftFilters.provider} label={providerLabels[provider]} onChange={(selectedProvider) => setDraftFilters((current) => ({ ...current, provider: selectedProvider }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Состояние интеграции</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="all" current={draftFilters.integration} label="Любое состояние" onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} /><FilterChoice value="connected" current={draftFilters.integration} label="Подключено" onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} /><FilterChoice value="pending" current={draftFilters.integration} label="Ожидает подключения" onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} /><FilterChoice value="error" current={draftFilters.integration} label="Ошибка синхронизации" onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} /><FilterChoice value="revoked" current={draftFilters.integration} label="Доступ отозван" onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} /><FilterChoice value="none" current={draftFilters.integration} label="Без интеграций" onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} /></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Результативность</legend><label><span className="mb-2 block text-[10px] text-[var(--muted)]">Минимум заявок за период</span><input inputMode="numeric" value={draftFilters.minLeads} onChange={(event) => setDraftFilters((current) => ({ ...current, minLeads: event.target.value.replace(/\D/g, "") }))} placeholder="0" className="focus-ring h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]" /></label></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="visitors-desc" current={draftFilters.sort} label="Сначала по трафику" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /><FilterChoice value="leads-desc" current={draftFilters.sort} label="Сначала по заявкам" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /><FilterChoice value="conversion-desc" current={draftFilters.sort} label="Сначала по конверсии" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /><FilterChoice value="name" current={draftFilters.sort} label="По названию" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /></div></fieldset>
        {filterError ? <p role="alert" className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]">{filterError}</p> : null}
      </div>
      <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5"><button type="button" onClick={() => { setDraftFilters(defaultFilters); setFilterError(null); }} className="focus-ring h-11 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"><RotateCcw className="mr-2 inline size-3.5" />Очистить</button><button type="button" onClick={applyFilters} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]">Показать сайты</button></footer>
    </Dialog>
    <ConfigureIntegrationDialog selection={integrationSelection} onClose={closeIntegrationDialog} />
  </div>;
}
