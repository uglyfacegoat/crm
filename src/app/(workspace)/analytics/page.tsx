import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck2, Download, Route, Wrench } from "lucide-react";
import { SummaryCard } from "@/components/analytics/summary-card";
import { TrendChart } from "@/components/analytics/trend-chart";
import { PageHeading } from "@/components/ui/page-heading";
import { formatMoneyMinor } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewAnalytics } from "@/server/analytics/preview";
import { getAnalyticsSnapshot } from "@/server/analytics/repository";
import { analyticsRanges, type AnalyticsMetric, type AnalyticsRange, type AnalyticsSnapshot } from "@/server/analytics/types";

export const metadata: Metadata = { title: "Аналитика" };

type AnalyticsView = "overview" | "sales" | "operations" | "finance";

const analyticsViews: Array<{ id: AnalyticsView; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "sales", label: "Продажи" },
  { id: "operations", label: "Операции" },
  { id: "finance", label: "Финансы" },
];

const viewCopy: Record<AnalyticsView, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Управленческий контур", title: "Обзор бизнеса", description: "Главные показатели компании за выбранный период — без повторения операционных экранов." },
  sales: { eyebrow: "Аналитика · Продажи", title: "Продажи и воронка", description: "Конверсия заказов, структура услуг и точки потери между этапами." },
  operations: { eyebrow: "Аналитика · Операции", title: "Выезды и команда", description: "Контроль выполнения работ, распределения нагрузки и повторных обращений." },
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
  return <section aria-label="Ключевые показатели" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric) => <SummaryCard key={metric.id} label={metric.label} value={formatMetric(metric)} change={metric.change} tone={metric.tone} />)}</section>;
}

function StageFlow({ stages }: { stages: AnalyticsSnapshot["orderStages"] }) {
  return (
    <section className="surface-panel p-5 sm:p-6" aria-labelledby="stage-flow-title">
      <div>
        <p className="eyebrow">Путь заказа</p>
        <h2 id="stage-flow-title" className="mt-2 font-display text-lg font-semibold text-[var(--text)]">От обращения до завершения</h2>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const previous = stages[index - 1];
          const loss = previous ? Math.max(0, previous.value - stage.value) : 0;
          return (
            <article key={stage.label} className="group min-h-36 rounded-[17px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 transition-colors hover:bg-[var(--surface-soft)]">
              <div className="flex items-center justify-between gap-3"><span className="grid size-7 place-items-center rounded-full bg-[var(--surface-inset)] font-display text-[9px] text-[var(--muted)]">0{index + 1}</span><span className="text-[9px] text-[var(--muted)]">{index === 0 ? "точка входа" : loss ? `−${loss} с этапа` : "без потерь"}</span></div>
              <p className="mt-5 text-xs font-medium text-[var(--text-secondary)]">{stage.label}</p>
              <div className="mt-2 flex items-end justify-between gap-3"><strong className="font-display text-3xl font-semibold tracking-[-0.05em] text-[var(--text)]">{stage.value}</strong><span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 font-display text-[10px] text-[var(--accent-ink)]">{stage.percent}%</span></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ServiceMosaic({ entries }: { entries: AnalyticsSnapshot["serviceMix"] }) {
  return (
    <section className="surface-panel p-5 sm:p-6" aria-labelledby="service-mix-title">
      <p className="eyebrow">Структура выручки</p>
      <h2 id="service-mix-title" className="mt-2 font-display text-lg font-semibold text-[var(--text)]">Какие услуги выбирают</h2>
      {entries.length ? <div className="mt-5 border-y border-[var(--line)]">{entries.map((entry, index) => <article key={entry.label} className="grid gap-3 border-t border-[var(--line)] py-4 first:border-t-0 sm:grid-cols-[2rem_minmax(0,1fr)_7rem_9rem] sm:items-center"><span className="font-display text-[9px] text-[var(--muted)]">{String(index + 1).padStart(2, "0")}</span><p className="text-xs leading-5 text-[var(--text-secondary)]">{entry.label}</p><strong className="font-display text-xl font-semibold tracking-[-0.04em] text-[var(--text)]">{entry.percent}%</strong><span className="text-right text-[10px] text-[var(--muted)]">{formatMoneyMinor(entry.amountMinor)}</span></article>)}</div> : <p className="mt-6 border border-dashed border-[var(--line)] p-8 text-center text-xs text-[var(--muted)]">За выбранный период нет услуг с выручкой.</p>}
    </section>
  );
}

function RateSpotlight({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className="surface-panel rounded-[18px] p-5 sm:p-6"><div className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ backgroundColor: tone }} /><p className="text-xs text-[var(--text-secondary)]">{label}</p></div><p className="mt-5 font-display text-5xl font-semibold tracking-[-0.07em] text-[var(--text)]">{value}<span className="ml-1 text-xl" style={{ color: tone }}>%</span></p><p className="mt-5 max-w-sm text-xs leading-5 text-[var(--muted)]">{note}</p></article>;
}

function TeamTable({ members }: { members: AnalyticsSnapshot["teamPerformance"] }) {
  return <section className="surface-panel overflow-hidden"><div className="border-b border-[var(--line)] p-5 sm:p-6"><p className="eyebrow">Команда</p><h2 className="mt-2 font-display text-lg font-semibold text-[var(--text)]">Результаты исполнителей</h2></div>{members.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]"><tr><th className="px-6 py-4 font-medium">Мастер</th><th className="px-4 py-4 font-medium">Выезды</th><th className="px-4 py-4 font-medium">Завершено</th><th className="px-6 py-4 text-right font-medium">Сумма заказов</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{members.map((member, index) => <tr key={member.id} className="transition-colors hover:bg-[var(--surface-raised)]"><td className="px-6 py-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-[10px] bg-[var(--support-soft)] font-display text-[10px] text-[var(--support-strong)]">{String(index + 1).padStart(2, "0")}</span><span className="text-xs font-medium text-[var(--text-secondary)]">{member.name}</span></div></td><td className="px-4 py-4 font-display text-sm text-[var(--text)]">{member.visits}</td><td className="px-4 py-4"><span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2.5 py-1 text-[10px] text-[var(--success)]">{member.completion}%</span></td><td className="px-6 py-4 text-right font-display text-xs text-[var(--text)]">{formatMoneyMinor(member.orderValueMinor)}</td></tr>)}</tbody></table></div> : <p className="p-8 text-center text-xs text-[var(--muted)]">Нет назначенных выездов за период.</p>}</section>;
}

function TopClients({ clients }: { clients: AnalyticsSnapshot["topClients"] }) {
  return <section className="surface-panel p-5 sm:p-6"><div><p className="eyebrow">Клиентская база</p><h2 className="mt-2 font-display text-lg font-semibold text-[var(--text)]">Клиенты с наибольшим оборотом</h2></div>{clients.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{clients.map((client, index) => <article key={client.id} className="rounded-[17px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 transition-colors hover:bg-[var(--surface-soft)]"><div className="flex items-start justify-between gap-4"><span className="grid size-7 place-items-center rounded-full bg-[var(--surface-inset)] font-display text-[9px] text-[var(--muted)]">0{index + 1}</span><span className="rounded-full bg-[var(--surface-inset)] px-2.5 py-1 text-[9px] text-[var(--muted)]">{client.orders} заказов</span></div><p className="mt-5 truncate text-sm font-medium text-[var(--text)]">{client.name}</p><p className="mt-2 font-display text-lg text-[var(--support-strong)]">{formatMoneyMinor(client.agreedMinor)}</p></article>)}</div> : <p className="p-8 text-center text-xs text-[var(--muted)]">За период нет заказов клиентов.</p>}</section>;
}

function AnalyticsContent({ view, snapshot }: { view: AnalyticsView; snapshot: AnalyticsSnapshot }) {
  const metricById = new Map(snapshot.metrics.map((metric) => [metric.id, metric]));
  const selectMetrics = (...ids: AnalyticsMetric["id"][]) => ids.map((id) => metricById.get(id)).filter((metric): metric is AnalyticsMetric => Boolean(metric));
  const agreed = metricById.get("agreed")?.value ?? 0;
  const paid = metricById.get("paid")?.value ?? 0;

  if (view === "sales") return <><MetricGrid metrics={selectMetrics("orders", "agreed", "average_order")} /><StageFlow stages={snapshot.orderStages} /><div className="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]"><ServiceMosaic entries={snapshot.serviceMix} /><TopClients clients={snapshot.topClients} /></div></>;
  if (view === "operations") return <><div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]"><MetricGrid metrics={selectMetrics("visits", "orders")} /><RateSpotlight label="Доля завершённых выездов" value={snapshot.completedVisitRate} note="Показывает, какая часть запланированной работы закрыта в выбранном периоде." tone="var(--success)" /></div><section className="grid gap-3 xl:grid-cols-[0.48fr_1fr]"><div className="surface-panel p-5 sm:p-6"><span className="grid size-9 place-items-center rounded-full bg-[var(--support-soft)] text-[var(--support-strong)]"><Wrench className="size-4" /></span><p className="mt-5 text-xs text-[var(--muted)]">Мастеров с выездами</p><strong className="mt-2 block font-display text-3xl text-[var(--text)]">{snapshot.teamPerformance.length}</strong><div className="mt-6 border-t border-[var(--line)] pt-4"><span className="grid size-8 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]"><CalendarCheck2 className="size-3.5" /></span><p className="mt-3 text-[10px] text-[var(--muted)]">Выездов команды</p><strong className="mt-1 block font-display text-xl text-[var(--text)]">{snapshot.teamPerformance.reduce((sum, member) => sum + member.visits, 0)}</strong></div></div><TeamTable members={snapshot.teamPerformance} /></section></>;
  if (view === "finance") return <><MetricGrid metrics={selectMetrics("agreed", "paid", "average_order")} /><section className="surface-panel p-5 sm:p-6"><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Деньги во времени</p><h2 className="mt-2 font-display text-lg font-semibold text-[var(--text)]">Согласовано, получено и результат</h2></div><span className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-1.5 text-[10px] text-[var(--warning)]">Ожидается {formatMoneyMinor(Math.max(0, agreed - paid))}</span></div><TrendChart labels={snapshot.financialTrend.labels} series={snapshot.financialTrend.series} /></section></>;
  return <><MetricGrid metrics={selectMetrics("orders", "agreed", "paid", "visits")} /><section className="grid gap-3 xl:grid-cols-[1.45fr_0.55fr]"><div className="surface-panel p-5 sm:p-6"><div className="mb-6"><p className="eyebrow">Динамика</p><h2 className="mt-2 font-display text-lg font-semibold text-[var(--text)]">Деньги за период</h2></div><TrendChart labels={snapshot.financialTrend.labels} series={snapshot.financialTrend.series} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><RateSpotlight label="Повторные клиенты" value={snapshot.repeatClientRate} note="Доля клиентов с несколькими заказами." tone="var(--support)" /><RateSpotlight label="Завершённые выезды" value={snapshot.completedVisitRate} note="Доля выполненной работы в календаре." tone="var(--success)" /></div></section><StageFlow stages={snapshot.orderStages} /></>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; view?: string }> }) {
  const member = await requireOfficeSession();
  if (!hasPermission(member, "analytics.read")) redirect("/");
  const params = await searchParams;
  const range = parseRange(params.range);
  const view = parseView(params.view);
  const snapshot = getAuthMode() === "preview" ? getPreviewAnalytics(range) : await getAnalyticsSnapshot(member, range);
  const copy = viewCopy[view];

  return (
    <div className="space-y-[clamp(1.5rem,1.2rem+0.8vw,2.5rem)]">
      <PageHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} action={<a href={`/api/v1/analytics/export?range=${range}`} className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"><Download className="size-4" />Экспорт CSV</a>} />

      <div className="sticky top-[calc(var(--header-height)+0.55rem)] z-20">
        <nav aria-label="Разделы аналитики" className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--canvas)]/94 py-1 backdrop-blur-xl">{analyticsViews.map((entry) => <Link key={entry.id} href={`/analytics?view=${entry.id}&range=${range}`} aria-current={view === entry.id ? "page" : undefined} className={`focus-ring shrink-0 rounded-[13px] px-3.5 py-2.5 text-xs font-medium transition-colors ${view === entry.id ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>{entry.label}</Link>)}</nav>
      </div>

      <div className="flex flex-col gap-3 border-b border-[var(--line)] py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]"><span className="grid size-7 place-items-center rounded-full bg-[var(--support-soft)] text-[var(--support-strong)]"><Route className="size-3.5" /></span><span>{snapshot.range.startDate} — {snapshot.range.endDate}</span></div>
        <div className="flex gap-1 rounded-full bg-[var(--surface-inset)] p-1" aria-label="Период аналитики">{analyticsRanges.map((days) => <Link key={days} href={`/analytics?view=${view}&range=${days}`} aria-current={range === days ? "true" : undefined} className={`focus-ring rounded-full px-3 py-2 text-[10px] transition-colors ${range === days ? "bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.1)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>{days === 365 ? "Год" : `${days} дней`}</Link>)}</div>
      </div>

      <main className="space-y-3"><AnalyticsContent view={view} snapshot={snapshot} /></main>
    </div>
  );
}
