import { CircleAlert, ClipboardCheck, Coins, Route } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { DashboardCalendar } from "@/components/dashboard/dashboard-calendar";
import { FinancialSummary } from "@/components/dashboard/financial-summary";
import { RecentOrders } from "@/components/dashboard/recent-orders";
import { TeamOnlineCard, UpdatedCard } from "@/components/dashboard/dashboard-status-cards";
import { TaskList } from "@/components/dashboard/task-list";
import { TodayVisits } from "@/components/dashboard/today-visits";
import { orders, visits, workTasks } from "@/lib/mock-data";

const metrics = [
  { label: "Выезды сегодня", value: "12", change: "+20% к вчера", icon: Route, tone: "yellow" as const, bars: [28, 42, 34, 66, 53, 82, 74] },
  { label: "Активные заказы", value: "47", change: "+12% за неделю", icon: ClipboardCheck, tone: "violet" as const, bars: [22, 48, 36, 70, 54, 88, 76] },
  { label: "Выручка за месяц", value: "1,25 млн ₽", change: "+18% к прошлому", icon: Coins, tone: "mint" as const, bars: [34, 28, 58, 44, 73, 68, 91] },
  { label: "Просрочено", value: "5", change: "Требуют внимания", icon: CircleAlert, tone: "red" as const, bars: [72, 45, 65, 32, 56, 42, 28] },
];

export default function DashboardPage() {
  return (
    <div className="rounded-[clamp(1rem,0.75rem+0.45vw,1.4rem)] border border-white/[0.07] bg-[#0a0f12]/55 p-[clamp(0.75rem,0.4rem+0.8vw,1.5rem)] shadow-[0_30px_90px_rgba(0,0,0,0.16)]">
      <header className="animate-rise mb-[clamp(1rem,0.75rem+0.6vw,1.5rem)] flex flex-col gap-4 min-[640px]:flex-row min-[640px]:items-end min-[640px]:justify-between">
        <div>
          <p className="eyebrow mb-2">Рабочий день · 25 августа</p>
          <h1 className="display-title whitespace-nowrap text-white max-[359px]:text-[1.35rem]">Доброе утро, Иван! <span aria-hidden="true">👋</span></h1>
          <p className="mt-2 text-[clamp(0.78rem,0.74rem+0.1vw,0.9rem)] text-[var(--muted)]">У вас 4 встречи и 7 задач на сегодня.</p>
        </div>
        <div className="hidden items-center gap-2 min-[640px]:flex">
          <span className="soft-button rounded-full px-3 py-2 text-[11px] text-[#8d969b]"><span className="mr-2 inline-block size-1.5 rounded-full bg-[var(--success)] shadow-[0_0_10px_var(--success)]" />4 мастера на линии</span>
          <span className="soft-button rounded-full px-3 py-2 text-[11px] text-[#8d969b]">Обновлено сейчас</span>
        </div>
      </header>

      <section aria-label="Основные показатели" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(7.5rem,0.58fr)_minmax(7.5rem,0.58fr)] 2xl:gap-3">
        {metrics.map((metric, index) => <MetricCard key={metric.label} {...metric} delay={`${80 + index * 45}ms`} />)}
        <TeamOnlineCard />
        <UpdatedCard />
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <TodayVisits visits={visits} />
        <TaskList tasks={workTasks} />
      </div>

      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[1.05fr_0.92fr_1fr]">
        <RecentOrders orders={orders.slice(0, 5)} />
        <DashboardCalendar visits={visits} />
        <FinancialSummary />
      </div>
    </div>
  );
}
