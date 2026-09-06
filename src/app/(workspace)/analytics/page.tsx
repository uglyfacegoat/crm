import type { Metadata } from "next";
import Link from "next/link";
import { BadgeRussianRuble, CalendarCheck2, Download, Route, Wrench } from "lucide-react";
import { SummaryCard } from "@/components/analytics/summary-card";
import { TrendChart } from "@/components/analytics/trend-chart";
import { PageHeading } from "@/components/ui/page-heading";
import { formatMoneyMinor } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewAnalytics } from "@/server/analytics/preview";
import { getAnalyticsSnapshot } from "@/server/analytics/repository";
import { analyticsRanges, type AnalyticsMetric, type AnalyticsRange, type AnalyticsSnapshot } from "@/server/analytics/types";

export const metadata: Metadata = { title: "Аналитика" };

type AnalyticsView = "overview" | "sales" | "visits" | "clients" | "masters" | "finance";

const analyticsViews: Array<{ id: AnalyticsView; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "sales", label: "Продажи" },
  { id: "visits", label: "Выезды" },
  { id: "clients", label: "Клиенты" },
  { id: "masters", label: "Мастера" },
  { id: "finance", label: "Финансы" },
];

const viewCopy: Record<AnalyticsView, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Управленческий контур", title: "Обзор бизнеса", description: "Главные показатели компании за выбранный период — без повторения операционных экранов." },
  sales: { eyebrow: "Аналитика · Продажи", title: "Продажи и воронка", description: "Конверсия заказов, структура услуг и точки потери между этапами." },
  visits: { eyebrow: "Аналитика · Выезды", title: "Качество выездов", description: "Объём работ, завершение визитов и распределение нагрузки по услугам." },
  clients: { eyebrow: "Аналитика · Клиенты", title: "Клиентская база", description: "Новые и повторные клиенты, выручка и самые активные заказчики." },
  masters: { eyebrow: "Аналитика · Мастера", title: "Эффективность команды", description: "Сравнение исполнителей по выездам, завершению работ и сумме заказов." },
  finance: { eyebrow: "Аналитика · Финансы", title: "Финансовая динамика", description: "Согласованные суммы, оплаты и операционный результат в одном срезе." },
};

function parseRange(value: string | undefined): AnalyticsRange {
  const parsed = Number(value);
  return analyticsRanges.includes(parsed as AnalyticsRange) ? parsed as AnalyticsRange : 30;
}

function parseView(value: string | undefined): AnalyticsView {
  return analyticsViews.some((view) => view.id === value) ? value as AnalyticsView : "overview";
}

function formatMetric(metric: AnalyticsMetric) {
  return metric.format === "money" ? formatMoneyMinor(metric.value) : new Intl.NumberFormat("ru-RU").format(metric.value);
}

function MetricGrid({ metrics }: { metrics: AnalyticsMetric[] }) {
  return <section aria-label="Ключевые показатели" className="grid gap-px overflow-hidden border border-white/[0.09] bg-white/[0.09] sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric) => <SummaryCard key={metric.id} label={metric.label} value={formatMetric(metric)} change={metric.change} tone={metric.tone} />)}</section>;
}

function StageFlow({ stages }: { stages: AnalyticsSnapshot["orderStages"] }) {
  return (
    <section className="panel overflow-hidden" aria-labelledby="stage-flow-title">
      <div className="border-b border-white/[0.06] p-5 sm:p-6">
        <p className="eyebrow">Путь заказа</p>
        <h2 id="stage-flow-title" className="mt-2 font-display text-lg font-semibold text-white">От обращения до завершения</h2>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const previous = stages[index - 1];
          const loss = previous ? Math.max(0, previous.value - stage.value) : 0;
          return (
            <article key={stage.label} className="group relative min-h-40 bg-[var(--surface)] p-5 transition-colors hover:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-3"><span className="font-display text-[10px] text-[#687279]">0{index + 1}</span><span className="text-[10px] text-[#707a80]">{index === 0 ? "точка входа" : loss ? `−${loss} с этапа` : "без потерь"}</span></div>
              <p className="mt-8 text-xs font-medium text-[#9da6aa]">{stage.label}</p>
              <div className="mt-2 flex items-end justify-between gap-3"><strong className="font-display text-3xl font-semibold tracking-[-0.05em] text-white">{stage.value}</strong><span className="pb-1 font-display text-sm text-[var(--accent)]">{stage.percent}%</span></div>
              <span className="absolute inset-x-5 bottom-0 h-px bg-[var(--accent)]/55" />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ServiceMosaic({ entries }: { entries: AnalyticsSnapshot["serviceMix"] }) {
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="service-mix-title">
      <p className="eyebrow">Структура выручки</p>
      <h2 id="service-mix-title" className="mt-2 font-display text-lg font-semibold text-white">Какие услуги выбирают</h2>
      {entries.length ? <div className="mt-5 border-y border-white/[0.08]">{entries.map((entry, index) => <article key={entry.label} className="grid gap-3 border-t border-white/[0.07] py-4 first:border-t-0 sm:grid-cols-[2rem_minmax(0,1fr)_7rem_9rem] sm:items-center"><span className="font-display text-[9px] text-[#697270]">{String(index + 1).padStart(2, "0")}</span><p className="text-xs leading-5 text-[#b0b8b6]">{entry.label}</p><strong className="font-display text-xl font-semibold tracking-[-0.04em] text-white">{entry.percent}%</strong><span className="text-right text-[10px] text-[#818a88]">{formatMoneyMinor(entry.amountMinor)}</span></article>)}</div> : <p className="mt-6 border border-dashed border-white/[0.08] p-8 text-center text-xs text-[#687279]">За выбранный период нет услуг с выручкой.</p>}
    </section>
  );
}

function RateSpotlight({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className="panel border-l-2 border-l-[var(--accent)] p-6"><p className="text-xs text-[#9da6a4]">{label}</p><p className="mt-5 font-display text-5xl font-semibold tracking-[-0.07em] text-white">{value}<span className="ml-1 text-xl" style={{ color: tone }}>%</span></p><p className="mt-5 max-w-sm text-xs leading-5 text-[#737c7a]">{note}</p></article>;
}

function TeamTable({ members }: { members: AnalyticsSnapshot["teamPerformance"] }) {
  return <section className="panel overflow-hidden"><div className="border-b border-white/[0.06] p-5 sm:p-6"><p className="eyebrow">Команда</p><h2 className="mt-2 font-display text-lg font-semibold text-white">Результаты исполнителей</h2></div>{members.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="text-[10px] uppercase tracking-[0.12em] text-[#626c72]"><tr><th className="px-6 py-4 font-medium">Мастер</th><th className="px-4 py-4 font-medium">Выезды</th><th className="px-4 py-4 font-medium">Завершено</th><th className="px-6 py-4 text-right font-medium">Сумма заказов</th></tr></thead><tbody className="divide-y divide-white/[0.055]">{members.map((member, index) => <tr key={member.id} className="transition-colors hover:bg-white/[0.025]"><td className="px-6 py-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-[10px] bg-[#9c82e8]/10 font-display text-[10px] text-[#b19aec]">{String(index + 1).padStart(2, "0")}</span><span className="text-xs font-medium text-[#dfe3df]">{member.name}</span></div></td><td className="px-4 py-4 font-display text-sm text-white">{member.visits}</td><td className="px-4 py-4"><span className="rounded-full border border-[#69d3a4]/15 bg-[#69d3a4]/[0.06] px-2.5 py-1 text-[10px] text-[#78dcb0]">{member.completion}%</span></td><td className="px-6 py-4 text-right font-display text-xs text-white">{formatMoneyMinor(member.orderValueMinor)}</td></tr>)}</tbody></table></div> : <p className="p-8 text-center text-xs text-[#687279]">Нет назначенных выездов за период.</p>}</section>;
}

function TopClients({ clients }: { clients: AnalyticsSnapshot["topClients"] }) {
  return <section className="panel overflow-hidden"><div className="border-b border-white/[0.06] p-5 sm:p-6"><p className="eyebrow">Клиентская база</p><h2 className="mt-2 font-display text-lg font-semibold text-white">Клиенты с наибольшим оборотом</h2></div>{clients.length ? <div className="grid gap-px bg-white/[0.055] sm:grid-cols-2">{clients.map((client, index) => <article key={client.id} className="bg-[var(--surface)] p-5 transition-colors hover:bg-white/[0.03]"><div className="flex items-start justify-between gap-4"><span className="font-display text-[10px] text-[#687279]">0{index + 1}</span><span className="text-[10px] text-[#778188]">{client.orders} заказов</span></div><p className="mt-7 truncate text-sm font-medium text-white">{client.name}</p><p className="mt-2 font-display text-lg text-[#9c82e8]">{formatMoneyMinor(client.agreedMinor)}</p></article>)}</div> : <p className="p-8 text-center text-xs text-[#687279]">За период нет заказов клиентов.</p>}</section>;
}

function AnalyticsContent({ view, snapshot }: { view: AnalyticsView; snapshot: AnalyticsSnapshot }) {
  const metricById = new Map(snapshot.metrics.map((metric) => [metric.id, metric]));
  const selectMetrics = (...ids: AnalyticsMetric["id"][]) => ids.map((id) => metricById.get(id)).filter((metric): metric is AnalyticsMetric => Boolean(metric));
  const agreed = metricById.get("agreed")?.value ?? 0;
  const paid = metricById.get("paid")?.value ?? 0;

  if (view === "sales") return <><MetricGrid metrics={selectMetrics("orders", "agreed", "average_order")} /><StageFlow stages={snapshot.orderStages} /><ServiceMosaic entries={snapshot.serviceMix} /></>;
  if (view === "visits") return <><div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]"><MetricGrid metrics={selectMetrics("visits", "orders")} /><RateSpotlight label="Доля завершённых выездов" value={snapshot.completedVisitRate} note="Показывает, какая часть запланированной работы закрыта в выбранном периоде." tone="#69d3a4" /></div><ServiceMosaic entries={snapshot.serviceMix} /></>;
  if (view === "clients") return <><div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]"><MetricGrid metrics={selectMetrics("clients", "orders")} /><RateSpotlight label="Повторные клиенты" value={snapshot.repeatClientRate} note="Доля клиентов, которые оформили больше одного заказа за выбранный период." tone="#9c82e8" /></div><TopClients clients={snapshot.topClients} /></>;
  if (view === "masters") return <><div className="grid gap-3 sm:grid-cols-3"><article className="panel p-5"><Wrench className="size-5 text-[#9c82e8]" /><p className="mt-7 text-xs text-[#7c868c]">Мастеров с выездами</p><strong className="mt-2 block font-display text-3xl text-white">{snapshot.teamPerformance.length}</strong></article><article className="panel p-5"><CalendarCheck2 className="size-5 text-[#69d3a4]" /><p className="mt-7 text-xs text-[#7c868c]">Выездов команды</p><strong className="mt-2 block font-display text-3xl text-white">{snapshot.teamPerformance.reduce((sum, member) => sum + member.visits, 0)}</strong></article><article className="panel p-5"><BadgeRussianRuble className="size-5 text-[#f2c95e]" /><p className="mt-7 text-xs text-[#7c868c]">Сумма назначенных заказов</p><strong className="mt-2 block font-display text-2xl text-white">{formatMoneyMinor(snapshot.teamPerformance.reduce((sum, member) => sum + member.orderValueMinor, 0))}</strong></article></div><TeamTable members={snapshot.teamPerformance} /></>;
  if (view === "finance") return <><MetricGrid metrics={selectMetrics("agreed", "paid", "average_order")} /><section className="panel p-5 sm:p-6"><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Деньги во времени</p><h2 className="mt-2 font-display text-lg font-semibold text-white">Согласовано, получено и результат</h2></div><span className="rounded-full border border-[#f2c95e]/15 bg-[#f2c95e]/[0.05] px-3 py-1.5 text-[10px] text-[#e7c567]">Ожидается {formatMoneyMinor(Math.max(0, agreed - paid))}</span></div><TrendChart labels={snapshot.financialTrend.labels} series={snapshot.financialTrend.series} /></section></>;
  return <><MetricGrid metrics={snapshot.metrics} /><section className="grid gap-3 xl:grid-cols-[1.45fr_0.55fr]"><div className="panel p-5 sm:p-6"><div className="mb-6"><p className="eyebrow">Динамика</p><h2 className="mt-2 font-display text-lg font-semibold text-white">Финансы за период</h2></div><TrendChart labels={snapshot.financialTrend.labels} series={snapshot.financialTrend.series} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><RateSpotlight label="Повторные клиенты" value={snapshot.repeatClientRate} note="Доля клиентов с несколькими заказами." tone="#9c82e8" /><RateSpotlight label="Завершённые выезды" value={snapshot.completedVisitRate} note="Доля выполненной работы в календаре." tone="#69d3a4" /></div></section><StageFlow stages={snapshot.orderStages} /></>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; view?: string }> }) {
  const member = await requireOfficeSession();
  const params = await searchParams;
  const range = parseRange(params.range);
  const view = parseView(params.view);
  const snapshot = getAuthMode() === "preview" ? getPreviewAnalytics(range) : await getAnalyticsSnapshot(member, range);
  const copy = viewCopy[view];

  return (
    <div className="space-y-[clamp(1.5rem,1.2rem+0.8vw,2.5rem)]">
      <PageHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} action={<a href={`/api/v1/analytics/export?range=${range}`} className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#a9b2b6] transition-colors hover:bg-white/[0.04] hover:text-white"><Download className="size-4" />Экспорт CSV</a>} />

      <div className="sticky top-[var(--header-height)] z-20 -mx-2 border-y border-white/[0.09] bg-[#070a0c]/95 px-2 backdrop-blur-xl">
        <nav aria-label="Разделы аналитики" className="flex gap-6 overflow-x-auto">{analyticsViews.map((entry) => <Link key={entry.id} href={`/analytics?view=${entry.id}&range=${range}`} aria-current={view === entry.id ? "page" : undefined} className={`focus-ring shrink-0 border-b-2 px-1 py-4 text-xs transition-colors ${view === entry.id ? "border-[var(--accent)] text-white" : "border-transparent text-[#858e8c] hover:text-white"}`}>{entry.label}</Link>)}</nav>
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.018] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[10px] text-[#687279]"><Route className="size-4 text-[#9c82e8]" /><span>{snapshot.range.startDate} — {snapshot.range.endDate}</span></div>
        <div className="flex gap-1" aria-label="Период аналитики">{analyticsRanges.map((days) => <Link key={days} href={`/analytics?view=${view}&range=${days}`} aria-current={range === days ? "true" : undefined} className={`focus-ring rounded-[9px] px-3 py-2 text-[10px] transition-colors ${range === days ? "bg-white/[0.08] text-white" : "text-[#687279] hover:text-white"}`}>{days === 365 ? "Год" : `${days} дней`}</Link>)}</div>
      </div>

      <main className="space-y-3"><AnalyticsContent view={view} snapshot={snapshot} /></main>
    </div>
  );
}
