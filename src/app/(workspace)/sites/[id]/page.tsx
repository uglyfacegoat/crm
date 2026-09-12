import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, CalendarClock, CircleAlert, CircleCheck, Cloud, Database, ExternalLink, Gauge, Globe2, HardDrive, MemoryStick, ShieldCheck } from "lucide-react";
import { SiteInfrastructureDialog } from "@/components/sites/site-infrastructure-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { formatMoneyMinor } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewWebsiteDetail } from "@/server/sites/preview";
import { getWebsiteDetail, WebsiteNotFoundError } from "@/server/sites/repository";
import type { WebsiteHealthStatus } from "@/server/sites/types";

export const metadata: Metadata = { title: "Карточка сайта" };
const integerFormatter = new Intl.NumberFormat("ru-RU");
const statusLabels = { active: "Активен", setup: "Настройка", attention: "Нужна проверка", disabled: "Отключён" } as const;
const healthPresentation: Record<WebsiteHealthStatus, { label: string; tone: string; icon: typeof CircleCheck }> = {
  healthy: { label: "Сайт работает штатно", tone: "var(--success)", icon: CircleCheck },
  degraded: { label: "Есть отклонения", tone: "var(--warning)", icon: CircleAlert },
  down: { label: "Сайт недоступен", tone: "var(--danger)", icon: CircleAlert },
};

function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value)); }
function usagePercent(used: number, capacity: number) { return capacity ? Math.min(100, Math.round((used / capacity) * 100)) : 0; }
function formatStorage(megabytes: number) { return megabytes >= 1024 ? `${(megabytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ` : `${integerFormatter.format(megabytes)} МБ`; }

function GaugeCard({ label, value, detail, percent, tone, icon: Icon }: { label: string; value: string; detail: string; percent: number; tone: string; icon: typeof Gauge }) {
  return <article className="surface-panel flex min-w-0 items-center gap-4 p-4"><div className="relative grid size-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${tone} ${percent * 3.6}deg, var(--surface-inset) 0)` }}><span className="absolute inset-[5px] rounded-full bg-[var(--surface)]" /><Icon className="relative size-5" style={{ color: tone }} /></div><div className="min-w-0"><p className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p><strong className="mt-1 block truncate font-display text-xl text-[var(--text)]">{value}</strong><p className="mt-1 truncate text-[9px] text-[var(--muted)]">{detail}</p></div></article>;
}

export default async function WebsiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireOfficeSession();
  const { id } = await params;
  let site;
  if (getAuthMode() === "preview") site = getPreviewWebsiteDetail(id);
  else {
    try { site = await getWebsiteDetail(member, id); }
    catch (error) { if (error instanceof WebsiteNotFoundError) notFound(); throw error; }
  }
  if (!site) notFound();
  const health = site.health;
  const healthView = health ? healthPresentation[health.healthStatus] : null;
  const memoryPercent = site.hosting && health ? usagePercent(health.memoryUsedMb, site.hosting.memoryCapacityMb) : 0;
  const diskPercent = site.hosting && health ? usagePercent(health.diskUsedMb, site.hosting.diskCapacityMb) : 0;

  return <div>
    <Link href="/sites" className="focus-ring inline-flex items-center gap-2 rounded-lg text-xs text-[var(--muted)] hover:text-[var(--accent-ink)]"><ArrowLeft className="size-3.5" />К сайтам</Link>
    <PageHeading eyebrow="Карточка сайта" title={site.name} description={site.domain} action={<div className="flex flex-wrap gap-2"><a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="focus-ring flex h-11 items-center gap-2 rounded-[13px] border border-[var(--line)] bg-[var(--surface)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"><ExternalLink className="size-4" />Открыть сайт</a><SiteInfrastructureDialog site={site} canWrite={hasPermission(member, "sites.write") && getAuthMode() !== "preview"} /></div>} />
    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><GaugeCard label="Посетители · 30 дней" value={integerFormatter.format(site.visitors)} detail={`${integerFormatter.format(site.pageviews)} просмотров`} percent={Math.min(100, site.conversionPercent * 10)} tone="var(--support)" icon={Globe2} /><GaugeCard label="Заявки" value={integerFormatter.format(site.leads)} detail={`${site.conversionPercent.toLocaleString("ru-RU")}% конверсия`} percent={Math.min(100, site.conversionPercent * 10)} tone="var(--accent)" icon={Activity} /><GaugeCard label="Оплаченные заказы" value={integerFormatter.format(site.paidOrders)} detail={formatMoneyMinor(site.paidRevenueMinor)} percent={site.leads ? Math.round((site.paidOrders / site.leads) * 100) : 0} tone="var(--support-strong)" icon={CircleCheck} /><GaugeCard label="Состояние" value={statusLabels[site.status]} detail={healthView?.label ?? "Мониторинг не настроен"} percent={health?.uptimePercent ?? 0} tone={healthView?.tone ?? "var(--muted)"} icon={healthView?.icon ?? Gauge} /></section>
    {site.hosting && health ? <><section className="mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.4fr)]"><article className="surface-panel p-5"><div className="flex items-center gap-2"><Cloud className="size-4 text-[var(--support)]" /><h2 className="text-sm font-semibold text-[var(--text)]">Хостинг и продление</h2></div><dl className="mt-5 grid gap-4 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{[["Провайдер", site.hosting.provider], ["Тариф", site.hosting.planName], ["Регион", site.hosting.serverRegion], ["Стоимость", `${formatMoneyMinor(site.hosting.monthlyCostMinor)} / месяц`], ["Следующая оплата", formatDate(site.hosting.renewalOn)], ["SSL действует до", formatDate(site.hosting.sslExpiresOn)]].map(([label, value]) => <div key={label}><dt className="text-[9px] uppercase tracking-[0.1em] text-[var(--muted)]">{label}</dt><dd className="mt-1.5 text-[var(--text-secondary)]">{value}</dd></div>)}</dl>{site.hosting.notes ? <p className="mt-5 border-t border-[var(--line)] pt-4 text-[10px] leading-5 text-[var(--muted)]">{site.hosting.notes}</p> : null}</article><article className="surface-panel p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Последняя проверка</p><h2 className="mt-2 text-sm font-semibold text-[var(--text)]">Ресурсы сервера</h2></div><span className="text-[10px] text-[var(--muted)]">{formatDateTime(health.measuredAt)}</span></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><GaugeCard label="CPU" value={`${health.cpuLoadPercent.toLocaleString("ru-RU")}%`} detail="текущая нагрузка" percent={health.cpuLoadPercent} tone={health.cpuLoadPercent > 80 ? "var(--danger)" : "var(--support)"} icon={Gauge} /><GaugeCard label="Память" value={`${memoryPercent}%`} detail={`${formatStorage(health.memoryUsedMb)} из ${formatStorage(site.hosting.memoryCapacityMb)}`} percent={memoryPercent} tone={memoryPercent > 85 ? "var(--warning)" : "var(--accent)"} icon={MemoryStick} /><GaugeCard label="Диск" value={`${diskPercent}%`} detail={`${formatStorage(health.diskUsedMb)} из ${formatStorage(site.hosting.diskCapacityMb)}`} percent={diskPercent} tone={diskPercent > 85 ? "var(--danger)" : "var(--support)"} icon={HardDrive} /><GaugeCard label="Ответ сервера" value={`${integerFormatter.format(health.responseTimeMs)} мс`} detail={`${health.uptimePercent.toLocaleString("ru-RU")}% доступность`} percent={Math.min(100, health.responseTimeMs / 10)} tone={health.responseTimeMs > 1000 ? "var(--danger)" : "var(--accent)"} icon={Database} /></div></article></section>
      <section className="surface-panel mt-4 overflow-hidden"><header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4"><div><h2 className="text-sm font-semibold text-[var(--text)]">История мониторинга</h2><p className="mt-1 text-[10px] text-[var(--muted)]">Последние {site.healthHistory.length} замеров</p></div><ShieldCheck className="size-4 text-[var(--success)]" /></header><div className="divide-y divide-[var(--line)]">{site.healthHistory.map((entry) => { const view = healthPresentation[entry.healthStatus]; return <article key={entry.id} className="grid gap-3 px-5 py-4 text-xs min-[640px]:grid-cols-[minmax(10rem,1.2fr)_repeat(4,minmax(5rem,0.7fr))] min-[640px]:items-center"><div className="flex items-center gap-3"><span className="size-2 rounded-full" style={{ backgroundColor: view.tone }} /><div><p className="font-medium text-[var(--text)]">{view.label}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{formatDateTime(entry.measuredAt)} · {entry.source === "monitor" ? "монитор" : "вручную"}</p></div></div><p className="text-[var(--text-secondary)]"><span className="mr-1 text-[var(--muted)]">CPU</span>{entry.cpuLoadPercent}%</p><p className="text-[var(--text-secondary)]"><span className="mr-1 text-[var(--muted)]">RAM</span>{formatStorage(entry.memoryUsedMb)}</p><p className="text-[var(--text-secondary)]"><span className="mr-1 text-[var(--muted)]">Диск</span>{formatStorage(entry.diskUsedMb)}</p><p className="text-[var(--text-secondary)]"><span className="mr-1 text-[var(--muted)]">Ответ</span>{entry.responseTimeMs} мс</p></article>; })}</div></section></> : <section className="surface-panel mt-4 grid min-h-72 place-items-center p-8 text-center"><div><CalendarClock className="mx-auto size-8 text-[var(--muted)]" /><h2 className="mt-4 text-base font-semibold text-[var(--text)]">Инфраструктура ещё не настроена</h2><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-[var(--muted)]">Добавьте хостинг, даты оплаты и SSL, лимиты ресурсов и первый контрольный замер. После подключения мониторинга новые показатели смогут поступать автоматически.</p></div></section>}
  </div>;
}
