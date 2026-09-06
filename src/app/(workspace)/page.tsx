import { MetricCard } from "@/components/dashboard/metric-card";
import { DashboardCalendar, type DashboardVisit } from "@/components/dashboard/dashboard-calendar";
import { FinancialSummary } from "@/components/dashboard/financial-summary";
import { RecentOrders } from "@/components/dashboard/recent-orders";
import { TaskList } from "@/components/dashboard/task-list";
import { TodayVisits } from "@/components/dashboard/today-visits";
import { formatMoneyMinor } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listMasters } from "@/server/masters/repository";
import { getPreviewMasters } from "@/server/masters/preview";
import { getPreviewOrders } from "@/server/orders/preview";
import { listOrders } from "@/server/orders/repository";
import { getPreviewTasks } from "@/server/tasks/preview";
import { listTasks } from "@/server/tasks/repository";
import { getPreviewVisits } from "@/server/visits/preview";
import { listVisits } from "@/server/visits/repository";
import type { ServiceVisit, VisitStatus } from "@/server/visits/types";

export default async function DashboardPage() {
  const member = await requireOfficeSession();
  const preview = getAuthMode() === "preview";
  const now = new Date();
  const [dashboardOrders, dashboardVisits, dashboardTasks, dashboardMasters] = preview
    ? [getPreviewOrders(), getPreviewVisits(), getPreviewTasks(), getPreviewMasters()]
    : await Promise.all([
      listOrders(member),
      listVisits(
      member,
      new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      new Date(now.getTime() + 21 * 86_400_000).toISOString(),
      ),
      listTasks(member),
      listMasters(member),
    ]);
  const calendarVisits = dashboardVisits.map(toDashboardVisit);
  const dashboardTimeZone = dashboardVisits[0]?.timezone ?? dashboardTasks.timeZone;
  const initialCalendarDate = localDateKey(now, dashboardTimeZone);
  const upcomingVisits = calendarVisits.filter((visit) => visit.date >= initialCalendarDate).slice(0, 5);
  const visibleTasks = dashboardTasks.tasks.filter((task) => task.column === "overdue" || task.column === "today").slice(0, 4);
  const activeOrders = dashboardOrders.filter((order) => order.status !== "Выполнен" && order.status !== "Отменён");
  const currentMonth = initialCalendarDate.slice(0, 7);
  const currentMonthOrders = dashboardOrders.filter((order) => localDateKey(new Date(order.createdAt), dashboardTimeZone).startsWith(currentMonth));
  const currentMonthAgreed = currentMonthOrders.filter((order) => order.status !== "Отменён").reduce((sum, order) => sum + order.agreedTotalMinor, 0);
  const overdueCount = dashboardOrders.filter((order) => order.status === "Просрочен").length + dashboardTasks.tasks.filter((task) => task.column === "overdue").length;
  const dailyVisitBars = countsByDate(calendarVisits.map((visit) => visit.date), initialCalendarDate);
  const dailyOrderBars = countsByDate(dashboardOrders.map((order) => localDateKey(new Date(order.createdAt), dashboardTimeZone)), initialCalendarDate);
  const metrics = [
    { label: "Выезды сегодня", value: String(calendarVisits.filter((visit) => visit.date === initialCalendarDate).length), change: "По актуальному расписанию", tone: "yellow" as const, bars: dailyVisitBars },
    { label: "Активные заказы", value: String(activeOrders.length), change: `${dashboardOrders.length} заказов всего`, tone: "violet" as const, bars: dailyOrderBars },
    { label: "Согласовано за месяц", value: formatMoneyMinor(currentMonthAgreed), change: `${currentMonthOrders.length} новых заказов`, tone: "mint" as const, bars: dailyOrderBars },
    { label: "Требуют внимания", value: String(overdueCount), change: `${dashboardTasks.tasks.filter((task) => task.column === "overdue").length} просроченных задач`, tone: "red" as const, bars: dailyVisitBars },
  ];
  const activeMasters = dashboardMasters.filter((master) => master.active);
  const mastersOnVisits = activeMasters.filter((master) => master.todayVisitCount > 0).length;
  return (
    <div className="rounded-[clamp(1rem,0.75rem+0.45vw,1.4rem)] border border-white/[0.07] bg-[#0a0f12]/55 p-[clamp(0.75rem,0.4rem+0.8vw,1.5rem)] shadow-[0_30px_90px_rgba(0,0,0,0.16)]">
      <header className="animate-rise mb-[clamp(1rem,0.75rem+0.6vw,1.5rem)] flex flex-col gap-4 min-[640px]:flex-row min-[640px]:items-end min-[640px]:justify-between">
        <div>
          <p className="eyebrow mb-2">Рабочий день · {formatDashboardDate(now, dashboardTimeZone)}</p>
          <h1 className="display-title whitespace-nowrap text-white max-[359px]:text-[1.35rem]">Доброе утро, {member.displayName.split(" ")[0]}!</h1>
          <p className="mt-2 text-[clamp(0.78rem,0.74rem+0.1vw,0.9rem)] text-[var(--muted)]">Сегодня {calendarVisits.filter((visit) => visit.date === initialCalendarDate).length} выездов и {visibleTasks.length} актуальных задач.</p>
        </div>
        <div className="hidden items-center gap-2 min-[640px]:flex">
          <span className="soft-button inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] text-[#adb5b7]"><span className="size-1.5 rounded-full bg-[var(--success)]" />{mastersOnVisits} из {activeMasters.length} мастеров на выездах</span>
          <span className="soft-button inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] text-[#adb5b7]"><span className="size-1.5 rounded-full bg-[#c8ced1]" />Данные синхронизированы <span className="rounded-full bg-white/[0.055] px-1.5 py-0.5 text-[9px] text-[#d4dcde]">сейчас</span></span>
        </div>
      </header>

      <section aria-label="Основные показатели" className="grid grid-cols-1 items-stretch gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric, index) => <MetricCard key={metric.label} {...metric} delay={`${80 + index * 45}ms`} />)}
      </section>

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
        <TodayVisits visits={upcomingVisits} dateLabel={formatDashboardDate(now, dashboardTimeZone)} />
        <TaskList tasks={visibleTasks} canWrite={!preview && hasPermission(member, "tasks.write")} />
      </div>

      <div className="mt-3 grid min-w-0 items-start gap-3 xl:grid-cols-[1.05fr_0.92fr_1fr]">
        <RecentOrders orders={dashboardOrders.slice(0, 5)} />
        <DashboardCalendar visits={calendarVisits} initialDate={initialCalendarDate} />
        <FinancialSummary orders={currentMonthOrders} />
      </div>
    </div>
  );
}

function formatDashboardDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "long" }).format(date);
}

function countsByDate(dateKeys: string[], endDate: string) {
  const end = new Date(`${endDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end.getTime() - (6 - index) * 86_400_000).toISOString().slice(0, 10);
    return dateKeys.filter((value) => value === date).length;
  });
}

const visitColors: Record<VisitStatus, DashboardVisit["color"]> = {
  planned: "yellow",
  confirmed: "mint",
  in_progress: "violet",
  completed: "lime",
  cancelled: "violet",
};

function localDateKey(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toDashboardVisit(visit: ServiceVisit): DashboardVisit {
  const scheduledStart = new Date(visit.scheduledStartAt);
  return {
    id: visit.id,
    orderId: visit.orderId,
    orderNumber: visit.orderNumber,
    date: localDateKey(scheduledStart, visit.timezone),
    time: new Intl.DateTimeFormat("ru-RU", {
      timeZone: visit.timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(scheduledStart),
    client: visit.client,
    address: visit.address,
    master: visit.master ?? "Мастер не назначен",
    color: visitColors[visit.statusCode],
  };
}
