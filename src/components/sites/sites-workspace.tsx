"use client";

import { ArrowUpRight, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ConfigureIntegrationDialog, CreateWebsiteButton, type WebsiteIntegrationSelection } from "@/components/sites/site-dialogs";
import { providerLabels, SiteCard } from "@/components/sites/site-card";
import { SiteTrafficTrendChart } from "@/components/sites/site-traffic-trend-chart";
import { TrafficSourcesChart } from "@/components/sites/traffic-sources-chart";
import { Dialog } from "@/components/ui/dialog";
import { formatMoneyMinor } from "@/lib/format";
import { clientCrypto as crypto } from "@/lib/client-id";
import { matchesSearchText } from "@/lib/search-normalization";
import { websiteProviders, type WebsiteIntegrationStatus, type WebsiteListItem, type WebsiteProvider, type WebsiteSnapshot, type WebsiteStatus } from "@/server/sites/types";

type Filter = "all" | WebsiteStatus;
type IntegrationFilter = "all" | "none" | WebsiteIntegrationStatus;
type SiteSort = "visitors-desc" | "leads-desc" | "conversion-desc" | "name";
type SiteFilters = { provider: "all" | WebsiteProvider; integration: IntegrationFilter; minLeads: string; sort: SiteSort };

const defaultFilters: SiteFilters = { provider: "all", integration: "all", minLeads: "", sort: "visitors-desc" };
const integerFormatter = new Intl.NumberFormat("ru-RU");
const periodDateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const periodDateWithYearFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function formatPeriodDate(value: string, includeYear = false) {
  const date = new Date(`${value}T12:00:00Z`);
  return (includeYear ? periodDateWithYearFormatter : periodDateFormatter).format(date).replaceAll(".", "");
}

function getPeriodDayCount(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function FilterChoice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"}`}>{label}</button>;
}

function AcquisitionFunnel({ snapshot }: { snapshot: WebsiteSnapshot }) {
  const leads = Math.max(0, snapshot.summary.leads);
  const orders = Math.max(0, snapshot.summary.orders);
  const paid = Math.max(0, snapshot.summary.paidOrders);
  const orderRate = leads ? Math.round(orders / leads * 100) : 0;
  const paidRate = orders ? Math.round(paid / orders * 100) : 0;
  const finalRate = leads ? paid / leads * 100 : 0;
  return <section className="figma-report-panel sites-funnel-card">
    <header><h2 className="figma-card-heading">Путь заявки до оплаты</h2><p className="figma-card-caption mt-1">Заявка ≠ заказ. Оплаченный заказ ≠ завершённый.</p></header>
    <div className="sites-funnel-desktop">
      <div className="sites-funnel-values"><strong>{integerFormatter.format(leads)} заявок</strong><strong>{integerFormatter.format(orders)} заказов</strong><strong>{integerFormatter.format(paid)} оплаченных</strong></div>
      <div className="sites-funnel-shape"><span /><i /></div>
      <div className="sites-funnel-notes"><span>{orderRate}% заявок → заказ</span><span>{paidRate}% заказов → оплата</span><strong>Получено {formatMoneyMinor(snapshot.summary.paidRevenueMinor)}</strong></div>
    </div>
    <div className="sites-funnel-mobile">
      {[{ label: "Входящие заявки", value: leads, rate: 100, note: `↓ ${orderRate}% заявок становятся заказами`, tone: "#25272c" }, { label: "Создано заказов", value: orders, rate: orderRate, note: `↓ ${paidRate}% заказов имеют оплату`, tone: "#9fa2aa" }, { label: "Оплаченные заказы", value: paid, rate: finalRate, note: "", tone: "#9dbbff" }].map((entry) => <article key={entry.label}>
        <div><span>{entry.label}</span><strong>{integerFormatter.format(entry.value)}</strong></div>
        <i><span style={{ width: `${Math.max(0, Math.min(100, entry.rate))}%`, background: entry.tone }} /></i>
        {entry.note ? <small>{entry.note}</small> : null}
      </article>)}
      <strong>{finalRate.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% заявок привели к оплате</strong>
    </div>
  </section>;
}

function SourceState({ snapshot }: { snapshot: WebsiteSnapshot }) {
  const configured = new Set(snapshot.sites.flatMap((site) => site.integrations.map((integration) => integration.provider)));
  return <section className="figma-report-panel sites-source-state">
    <h2 className="figma-card-heading">Источники ещё не подключены</h2>
    <div>{websiteProviders.map((provider) => <article key={provider}><span>{providerLabels[provider]}</span><small>{configured.has(provider) ? "Ожидает синхронизации" : "Не настроено"}</small><ArrowUpRight aria-hidden="true" /></article>)}</div>
  </section>;
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
    return visible.toSorted((left, right) => filters.sort === "leads-desc" ? right.leads - left.leads : filters.sort === "conversion-desc" ? right.conversionPercent - left.conversionPercent : filters.sort === "name" ? left.name.localeCompare(right.name, "ru") : right.visitors - left.visitors);
  }, [filter, filters, query, snapshot.sites]);
  const activeFilterCount = [filters.provider !== "all", filters.integration !== "all", Boolean(filters.minLeads), filters.sort !== "visitors-desc"].filter(Boolean).length;
  const periodDays = getPeriodDayCount(snapshot.period.startDate, snapshot.period.endDate);
  const hasTrafficData = snapshot.trafficTrend.series.some((series) => series.values.some((value) => value !== null));
  const shortPeriod = `${formatPeriodDate(snapshot.period.startDate)} — ${formatPeriodDate(snapshot.period.endDate)}`;
  const mobilePeriod = `${formatPeriodDate(snapshot.period.startDate)} — ${formatPeriodDate(snapshot.period.endDate, true)}`;

  function resetFilters() {
    setFilter("all"); setQuery(""); setFilters(defaultFilters); setDraftFilters(defaultFilters); setFilterError(null);
  }

  function applyFilters() {
    if (draftFilters.minLeads && (!/^\d+$/.test(draftFilters.minLeads) || Number(draftFilters.minLeads) > 1_000_000)) {
      setFilterError("Минимум заявок должен быть целым числом от 0 до 1 000 000."); return;
    }
    setFilters(draftFilters); setFiltersOpen(false);
  }

  return <div className="figma-report-page sites-page">
    <header className="sites-page-header">
      <p className="figma-report-kicker">Единый центр сайтов</p>
      <h1 className="figma-report-title mt-[9px]">Сайты и трафик</h1>
      <p className="figma-report-description mt-[6px] hidden md:block">Виден весь путь: от источника аудитории до денег в CRM.</p>
      <p className="sites-mobile-period">{mobilePeriod} · {periodDays} дней</p>
      <div className="sites-create"><CreateWebsiteButton canWrite={canWrite} /></div>
    </header>

    <div className="sites-controls">
      <button type="button" data-active={filter === "all"} onClick={() => setFilter("all")} className="figma-report-control focus-ring">Все сайты · {snapshot.sites.length}</button>
      <button type="button" data-active={filter === "active"} onClick={() => setFilter("active")} className="figma-report-control focus-ring">Активные</button>
      <button type="button" onClick={() => { setDraftFilters(filters); setFilterError(null); setFiltersOpen(true); }} className="figma-report-control sites-filter-button focus-ring"><SlidersHorizontal className="size-4" />Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
      <label className="sites-search"><Search aria-hidden="true" /><span className="sr-only">Поиск по сайтам</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или домену" /></label>
      <span className="sites-period">{shortPeriod} · {periodDays} дней</span>
      {query || filter !== "all" || activeFilterCount ? <button type="button" onClick={resetFilters} aria-label="Сбросить фильтры" className="sites-reset focus-ring"><RotateCcw /></button> : null}
    </div>

    <div className="sites-figma-layout">
      <AcquisitionFunnel snapshot={snapshot} />
      <div className="sites-chart-row">
        <section className="figma-report-panel sites-traffic-card"><header><h2 className="figma-card-heading">Как приходит аудитория</h2><p className="figma-card-caption mt-1">Уникальные посетители · данные подключённых источников</p></header><div className="sites-traffic-total"><strong>{hasTrafficData ? integerFormatter.format(snapshot.summary.visitors) : "—"}</strong><span>за {periodDays} дней</span></div><SiteTrafficTrendChart {...snapshot.trafficTrend} emptyMessage="За период данных о трафике нет" /></section>
        <section className="figma-report-panel sites-sources-card"><header><h2 className="figma-card-heading">Откуда приходят заявки</h2><p className="figma-card-caption mt-1">{integerFormatter.format(snapshot.summary.leads)} заявок · доля источника</p></header><TrafficSourcesChart entries={snapshot.trafficSources} /></section>
      </div>

      <section className="figma-report-panel sites-register"><header><h2 className="figma-card-heading">Домены и результат</h2><p className="figma-card-caption mt-1">Сайтов: {sites.length}</p></header><div className="sites-register-head"><span>Сайт</span><span>Трафик за {periodDays} дней</span><span>Посетители</span><span>Заявки</span><span>С оплатой</span><span>Получено</span><span /></div><div className="sites-register-list">{sites.map((site, index) => <SiteCard key={site.id} site={site} index={index} onConfigure={openIntegrationDialog} canWrite={canWrite && !preview} />)}{!sites.length ? <p className="p-6 text-sm text-[var(--muted)]">{snapshot.sites.length ? "Нет сайтов по выбранным фильтрам." : "Сайты ещё не добавлены."}</p> : null}</div></section>
      <SourceState snapshot={snapshot} />
      {preview ? <section className="figma-report-panel sites-missing-state"><h2 className="figma-card-heading">Нет источника ≠ нет посетителей</h2><p>В рабочем режиме до подключения источника здесь будет «Нет данных», а не фиктивный график.</p></section> : null}
      <button type="button" disabled={!canWrite || !snapshot.sites[0]} onClick={() => snapshot.sites[0] && openIntegrationDialog(snapshot.sites[0])} className="figma-report-control sites-source-button focus-ring">Настроить источники</button>
    </div>

    <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Фильтры сайтов" description="Отберите домены по источнику данных, состоянию интеграции и результативности.">
      <div className="space-y-7 p-5 sm:p-7">
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Источник данных</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="all" current={draftFilters.provider} label="Любой источник" onChange={(provider) => setDraftFilters((current) => ({ ...current, provider }))} />{websiteProviders.map((provider) => <FilterChoice key={provider} value={provider} current={draftFilters.provider} label={providerLabels[provider]} onChange={(provider) => setDraftFilters((current) => ({ ...current, provider }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Состояние интеграции</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup">{(["all", "connected", "pending", "error", "revoked", "none"] as const).map((value) => <FilterChoice key={value} value={value} current={draftFilters.integration} label={({ all: "Любое состояние", connected: "Подключено", pending: "Ожидает подключения", error: "Ошибка синхронизации", revoked: "Доступ отозван", none: "Без интеграций" })[value]} onChange={(integration) => setDraftFilters((current) => ({ ...current, integration }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Результативность</legend><label><span className="mb-2 block text-[10px] text-[var(--muted)]">Минимум заявок за период</span><input inputMode="numeric" value={draftFilters.minLeads} onChange={(event) => setDraftFilters((current) => ({ ...current, minLeads: event.target.value.replace(/\D/g, "") }))} placeholder="0" className="focus-ring h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm outline-none" /></label></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup">{(["visitors-desc", "leads-desc", "conversion-desc", "name"] as const).map((value) => <FilterChoice key={value} value={value} current={draftFilters.sort} label={({ "visitors-desc": "Сначала по трафику", "leads-desc": "Сначала по заявкам", "conversion-desc": "Сначала по конверсии", name: "По названию" })[value]} onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} />)}</div></fieldset>
        {filterError ? <p role="alert" className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]">{filterError}</p> : null}
      </div>
      <footer className="sticky bottom-0 grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t bg-white p-4"><button type="button" onClick={() => setDraftFilters(defaultFilters)} className="figma-report-control px-4">Очистить</button><button type="button" onClick={applyFilters} className="figma-report-control bg-black px-4 text-white">Показать сайты</button></footer>
    </Dialog>
    <ConfigureIntegrationDialog selection={integrationSelection} onClose={closeIntegrationDialog} />
  </div>;
}
