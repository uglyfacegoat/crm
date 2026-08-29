import type { Metadata } from "next";
import { ChartNoAxesCombined, CircleCheck, Link2, MousePointerClick, Plus, SearchCheck, UsersRound } from "lucide-react";
import { ProgressList } from "@/components/analytics/progress-list";
import { SummaryCard } from "@/components/analytics/summary-card";
import { TrendChart } from "@/components/analytics/trend-chart";
import { SiteCard } from "@/components/sites/site-card";
import { PageHeading } from "@/components/ui/page-heading";
import { connectedSites, siteTrafficChart, trafficSources } from "@/lib/analytics-data";

export const metadata: Metadata = { title: "Сайты" };

const integrations = [
  { name: "Яндекс Метрика", description: "Визиты, цели, источники и офлайн-конверсии", status: "Планируется" },
  { name: "Google Analytics 4", description: "Пользователи, события, каналы и конверсии", status: "Планируется" },
  { name: "Search Console", description: "Клики, показы, запросы и позиции в Google", status: "Планируется" },
  { name: "Яндекс Вебмастер", description: "Индексация, поисковая видимость и ошибки", status: "Планируется" },
];

export default function SitesPage() {
  return (
    <div>
      <PageHeading
        eyebrow="Единый центр сайтов"
        title="Сайты и трафик"
        description="Подключения, качество трафика и путь каждого обращения от сайта до оплаченного заказа. Показатели ниже — демонстрационные."
        action={<button disabled title="Подключение появится вместе с защищённым хранением OAuth-токенов" className="flex h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-[var(--accent)]/60 px-4 text-sm font-semibold text-[#101308]/70"><Plus className="size-4" />Подключить сайт</button>}
      />

      <section aria-label="Сводка по сайтам" className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid gap-3 min-[460px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SummaryCard label="Сайтов в контуре" value="4" change="3 активны" tone="lime" />
        <SummaryCard label="Посетители" value="32 920" change="+18,7%" tone="mint" />
        <SummaryCard label="Просмотры" value="68 235" change="+21,7%" tone="violet" />
        <SummaryCard label="Клики" value="3 624" change="+16,4%" tone="mint" />
        <SummaryCard label="Целевые действия" value="541" change="+13,2%" tone="violet" />
        <SummaryCard label="Средняя конверсия" value="1,64%" change="+0,2 п.п." tone="amber" />
      </section>

      <div className="mt-4 flex min-w-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06]">
        {["Все сайты", "Активные", "Неактивные", "Требуют внимания"].map((tab, index) => <button key={tab} disabled={index !== 0} title={index !== 0 ? "Фильтры заработают после подключения реестра сайтов" : undefined} className={`focus-ring h-11 shrink-0 border-b-2 px-3 text-xs ${index === 0 ? "border-[var(--accent)] text-[var(--accent)]" : "cursor-not-allowed border-transparent text-[#626c72]"}`}>{tab}</button>)}
      </div>

      <section aria-label="Подключённые сайты" className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4 2xl:gap-5">
        {connectedSites.map((site, index) => <SiteCard key={site.id} site={site} index={index} />)}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)] 2xl:gap-5">
        <section className="surface-panel min-w-0 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]">
          <div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Все сайты</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold tracking-[-0.035em] text-white">Трафик и целевые действия</h2></div><ChartNoAxesCombined className="size-5 text-[#657077]" /></div>
          <TrendChart {...siteTrafficChart} scale="per-series" />
        </section>
        <section className="surface-panel p-[clamp(1rem,0.75rem+0.8vw,1.75rem)]">
          <div className="mb-6"><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Каналы</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold tracking-[-0.035em] text-white">Источники трафика</h2></div>
          <ProgressList entries={trafficSources} accent="#9c82e8" />
          <div className="mt-7 grid grid-cols-2 gap-2"><div className="rounded-xl bg-white/[0.035] p-3"><SearchCheck className="size-4 text-[var(--accent)]" /><p className="mt-3 text-[9px] uppercase tracking-[0.1em] text-[#687279]">Поисковые клики</p><strong className="mt-1 block font-display text-lg text-white">8 420</strong></div><div className="rounded-xl bg-white/[0.035] p-3"><MousePointerClick className="size-4 text-[#9c82e8]" /><p className="mt-3 text-[9px] uppercase tracking-[0.1em] text-[#687279]">Цена лида</p><strong className="mt-1 block font-display text-lg text-white">1 840 ₽</strong></div></div>
        </section>
      </div>

      <section className="surface-panel mt-4 p-[clamp(1rem,0.75rem+0.8vw,1.75rem)] 2xl:mt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Интеграции</p><h2 className="mt-2 font-display text-[clamp(1rem,0.9rem+0.35vw,1.3rem)] font-semibold tracking-[-0.035em] text-white">Источники аналитики</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-[#747e84]">После серверного подключения CRM будет регулярно синхронизировать агрегаты и связывать обращения с реальными заказами.</p></div><span className="flex w-fit items-center gap-2 rounded-full border border-white/[0.07] px-3 py-2 text-[10px] text-[#7c868c]"><Link2 className="size-3.5" />Требуется OAuth</span></div>
        <div className="mt-6 grid gap-px overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.06] md:grid-cols-2 2xl:grid-cols-4">
          {integrations.map((integration) => <article key={integration.name} className="min-w-0 bg-[#0d1317] p-4"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-white/[0.045]"><CircleCheck className="size-3.5 text-[#59636a]" /></span><h3 className="truncate text-xs font-semibold text-white">{integration.name}</h3></div><p className="mt-3 min-h-10 text-[10px] leading-5 text-[#707a80]">{integration.description}</p><span className="mt-4 inline-block rounded-full bg-white/[0.04] px-2 py-1 text-[9px] text-[#707a80]">{integration.status}</span></article>)}
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#69d3a4]/15 bg-[#69d3a4]/[0.035] p-4"><UsersRound className="mt-0.5 size-4 shrink-0 text-[#69d3a4]" /><p className="text-[11px] leading-5 text-[#8da399]">Главная ценность — не отдельный счётчик посетителей, а сквозная связь: источник → заявка → заказ → выручка → операционный остаток. Именно такую модель закладываем в будущий серверный контур.</p></div>
      </section>
    </div>
  );
}
