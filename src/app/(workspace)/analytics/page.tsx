import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CalendarRange, CircleAlert, Download } from "lucide-react";
import { ServiceMixChart } from "@/components/analytics/service-mix-chart";
import { SummaryCard } from "@/components/analytics/summary-card";
import { TrendChart } from "@/components/analytics/trend-chart";
import { PageHeading } from "@/components/ui/page-heading";
import { formatMoneyMinor } from "@/lib/format";
import { getAnalyticsSnapshot } from "@/server/analytics/repository";
import { getPreviewAnalytics } from "@/server/analytics/preview";
import { analyticsRanges, type AnalyticsMetric, type AnalyticsRange } from "@/server/analytics/types";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Аналитика" };

function PanelHeading({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return <div className="mb-6 flex items-end justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">{eyebrow}</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold tracking-[-0.035em] text-white">{title}</h2></div>{meta ? <p className="hidden text-[10px] text-[#687279] sm:block">{meta}</p> : null}</div>;
}

function parseRange(value: string | undefined): AnalyticsRange {
  const parsed = Number(value);
  return analyticsRanges.includes(parsed as AnalyticsRange) ? parsed as AnalyticsRange : 30;
}

function formatMetric(metric: AnalyticsMetric) {
  return metric.format === "money" ? formatMoneyMinor(metric.value) : new Intl.NumberFormat("ru-RU").format(metric.value);
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const member = await requireSession();
  const range = parseRange((await searchParams).range);
  const analytics = getAuthMode() === "preview" ? getPreviewAnalytics(range) : await getAnalyticsSnapshot(member, range);
  const periodLabel = `${formatDateOnly(analytics.range.startDate)} — ${formatDateOnly(analytics.range.endDate)}`;

  return <div><PageHeading eyebrow="Управленческий контур" title="Аналитика" description="Фактические показатели PostgreSQL: заказы, деньги, выезды, клиенты, услуги и загрузка мастеров." action={<div className="flex gap-2"><span className="soft-button flex h-11 items-center gap-2 rounded-xl px-3 text-xs text-[#929ba0]"><CalendarRange className="size-4" />{periodLabel}</span><a href={`/api/v1/analytics/export?range=${range}`} download className="focus-ring soft-button grid size-11 place-items-center rounded-xl text-[var(--accent)]" aria-label="Экспортировать аналитику в CSV" title="Скачать полный отчёт CSV"><Download className="size-4" /></a></div>} />

    <div className="mt-5 flex flex-col gap-3 border-b border-white/[0.06] pb-3 sm:flex-row sm:items-end sm:justify-between"><nav aria-label="Разделы аналитики" className="flex gap-1 overflow-x-auto">{["Обзор", "Продажи", "Выезды", "Клиенты", "Мастера", "Финансы"].map((tab, index) => <button key={tab} disabled={index !== 0} title={index !== 0 ? "Детализация появится после базового отчёта" : undefined} className={`focus-ring h-10 shrink-0 border-b-2 px-3 text-xs ${index === 0 ? "border-[var(--accent)] text-[var(--accent)]" : "cursor-not-allowed border-transparent text-[#626c72]"}`}>{tab}</button>)}</nav><div className="flex gap-1 rounded-xl border border-white/[0.07] p-1">{analyticsRanges.map((days) => <Link key={days} href={`/analytics?range=${days}`} className={`focus-ring rounded-lg px-3 py-2 text-[10px] ${range === days ? "bg-[var(--accent)] font-semibold text-[#111509]" : "text-[#7b858b] hover:text-white"}`}>{days === 365 ? "1 год" : `${days} дней`}</Link>)}</div></div>

    <section aria-label="Ключевые показатели" className="mt-5 grid gap-3 min-[460px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{analytics.metrics.map((metric) => <SummaryCard key={metric.id} label={metric.label} value={formatMetric(metric)} change={metric.change} tone={metric.tone} />)}</section>

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)] 2xl:gap-5"><section className="surface-panel min-w-0 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]"><PanelHeading eyebrow="Финансы" title="Динамика по заказам" meta={`${periodLabel} · ₽`} /><TrendChart {...analytics.financialTrend} /></section><section className="surface-panel p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]"><PanelHeading eyebrow="Процесс" title="Прохождение заказов" meta="по дате создания" /><div className="space-y-4">{analytics.orderStages.map((stage, index) => <div key={stage.label}><div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-xs text-[#a1a9ad]">{stage.label}</p><p className="mt-1 font-display text-lg font-semibold text-white">{stage.value}</p></div><span className="text-[10px] text-[#6d767c]">{stage.percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[#80d59e]" style={{ width: `${stage.percent}%`, opacity: 1 - index * 0.12 }} /></div></div>)}</div>{analytics.orderStages[0]?.value === 0 ? <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] leading-5 text-[#747e84]"><CircleAlert className="mr-2 inline size-3.5" />За выбранный период заказов ещё нет.</div> : null}</section></div>

    <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-[0.8fr_1.2fr] 2xl:gap-5"><section className="surface-panel p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]"><PanelHeading eyebrow="Портфель" title="Структура услуг" meta="по согласованной стоимости" /><ServiceMixChart entries={analytics.serviceMix} /></section><section className="surface-panel min-w-0 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]"><PanelHeading eyebrow="Команда" title="Загрузка мастеров" meta="по датам выездов" />{analytics.teamPerformance.length ? <><div className="hidden overflow-x-auto min-[620px]:block"><table className="w-full min-w-[580px] text-left"><thead><tr className="text-[9px] uppercase tracking-[0.12em] text-[#616b72]"><th className="pb-3 font-medium">Мастер</th><th className="pb-3 font-medium">Выезды</th><th className="pb-3 font-medium">Завершено</th><th className="pb-3 text-right font-medium">Сумма заказов</th></tr></thead><tbody className="divide-y divide-white/[0.055]">{analytics.teamPerformance.map((member) => <tr key={member.id}><td className="py-3 text-xs font-medium text-[#dce0dc]">{member.name}</td><td className="py-3 font-display text-xs text-white">{member.visits}</td><td className="py-3"><span className="text-xs text-[#93a099]">{member.completion}%</span></td><td className="py-3 text-right font-display text-xs text-white">{formatMoneyMinor(member.orderValueMinor)}</td></tr>)}</tbody></table></div><div className="space-y-4 min-[620px]:hidden">{analytics.teamPerformance.map((member) => <article key={member.id} className="rounded-xl bg-white/[0.03] p-3"><div className="flex justify-between gap-3"><p className="truncate text-xs font-medium text-white">{member.name}</p><p className="shrink-0 font-display text-xs text-white">{formatMoneyMinor(member.orderValueMinor)}</p></div><p className="mt-2 text-[10px] text-[#707a80]">{member.visits} выездов · {member.completion}% завершено</p></article>)}</div></> : <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-white/[0.07] text-center text-xs text-[#69737a]">Назначьте мастеров на выезды,<br />чтобы увидеть загрузку команды</div>}<div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#69d3a4]/[0.055] p-3"><ArrowUpRight className="size-4 text-[#69d3a4]" /><p className="mt-3 text-[10px] text-[#819088]">Повторные клиенты</p><strong className="mt-1 block font-display text-lg text-white">{analytics.repeatClientRate}%</strong></div><div className="rounded-xl bg-[#9c82e8]/[0.055] p-3"><ArrowDownRight className="size-4 rotate-180 text-[#ae98eb]" /><p className="mt-3 text-[10px] text-[#8f8798]">Завершено выездов</p><strong className="mt-1 block font-display text-lg text-white">{analytics.completedVisitRate}%</strong></div></div></section></div>

    <section className="surface-panel mt-4 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]"><PanelHeading eyebrow="Клиенты" title="Топ по согласованной стоимости" meta="отменённые заказы исключены" />{analytics.topClients.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{analytics.topClients.map((client, index) => <Link key={client.id} href={`/clients/${client.id}`} className="focus-ring flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.035]"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)]/[0.07] font-display text-xs text-[var(--accent)]">{index + 1}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-white">{client.name}</strong><span className="mt-1 block text-[9px] text-[#6d777d]">{client.orders} заказ.</span></span><strong className="shrink-0 font-display text-xs text-white">{formatMoneyMinor(client.agreedMinor)}</strong></Link>)}</div> : <p className="rounded-xl border border-dashed border-white/[0.07] py-10 text-center text-xs text-[#69737a]">В выбранном периоде нет заказов для рейтинга</p>}</section>
  </div>;
}
