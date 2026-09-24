import { ActivityChart } from "@/components/dashboard/activity-chart";
import {
  DashboardCalendar,
  type DashboardVisit,
} from "@/components/dashboard/dashboard-calendar";
import { FinancialSummary } from "@/components/dashboard/financial-summary";
import { DashboardDateCard } from "@/components/dashboard/dashboard-date-card";
import { RecentOrders } from "@/components/dashboard/recent-orders";
import { TaskList } from "@/components/dashboard/task-list";
import { TodayVisits } from "@/components/dashboard/today-visits";
import { formatMoneyMinor } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
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
  const [dashboardOrders, dashboardVisits, dashboardTasks] = preview
    ? [getPreviewOrders(), getPreviewVisits(), getPreviewTasks()]
    : await Promise.all([
        listOrders(member),
        listVisits(
          member,
          new Date(now.getTime() - 30 * 86_400_000).toISOString(),
          new Date(now.getTime() + 21 * 86_400_000).toISOString(),
        ),
        listTasks(member),
      ]);
  const calendarVisits = dashboardVisits.map(toDashboardVisit);
  const dashboardTimeZone =
    dashboardVisits[0]?.timezone ?? dashboardTasks.timeZone;
  const initialCalendarDate = localDateKey(now, dashboardTimeZone);
  const todayVisits = calendarVisits
    .filter((visit) => visit.date === initialCalendarDate)
    .toSorted((left, right) => left.time.localeCompare(right.time));
  const upcomingVisits = calendarVisits
    .filter((visit) => visit.date >= initialCalendarDate)
    .toSorted((left, right) =>
      `${left.date}-${left.time}`.localeCompare(`${right.date}-${right.time}`),
    );
  const routeVisits = (todayVisits.length ? todayVisits : upcomingVisits).slice(
    0,
    6,
  );
  const visibleTasks = dashboardTasks.tasks
    .filter((task) => task.column === "overdue" || task.column === "today")
    .toSorted((left, right) => taskUrgency(left) - taskUrgency(right))
    .slice(0, 6);
  const activeOrders = dashboardOrders.filter(
    (order) => order.status !== "Выполнен" && order.status !== "Отменён",
  );
  const currentMonth = initialCalendarDate.slice(0, 7);
  const currentMonthOrders = dashboardOrders.filter((order) =>
    localDateKey(new Date(order.createdAt), dashboardTimeZone).startsWith(
      currentMonth,
    ),
  );
  const currentMonthAgreed = currentMonthOrders
    .filter((order) => order.status !== "Отменён")
    .reduce((sum, order) => sum + order.agreedTotalMinor, 0);
  const overdueTaskCount = dashboardTasks.tasks.filter(
    (task) => task.column === "overdue",
  ).length;
  const overdueOrderCount = dashboardOrders.filter(
    (order) => order.status === "Просрочен",
  ).length;
  const overdueCount = overdueOrderCount + overdueTaskCount;
  const ordersInApproval = dashboardOrders.filter(
    (order) => order.status === "На согласовании",
  ).length;
  const unassignedVisits = upcomingVisits.filter(
    (visit) => visit.master === "Мастер не назначен",
  ).length;
  const unassignedActiveOrders = activeOrders.filter(
    (order) => order.master === null,
  ).length;
  const attentionCount = overdueCount + ordersInApproval + unassignedVisits;
  const dailyVisitBars = countsByDate(
    calendarVisits.map((visit) => visit.date),
    initialCalendarDate,
  );
  const activityCounts = countsByDate(calendarVisits.map((visit) => visit.date), initialCalendarDate, 30);
  const dailyOrderBars = countsByDate(
    dashboardOrders.map((order) =>
      localDateKey(new Date(order.createdAt), dashboardTimeZone),
    ),
    initialCalendarDate,
  );
  const dailyTaskBars = countsByDate(
    dashboardTasks.tasks.flatMap((task) =>
      task.dueAt ? [localDateKey(new Date(task.dueAt), dashboardTimeZone)] : [],
    ),
    initialCalendarDate,
  );
  const metrics = [
    {
      label: "Маршрут сегодня",
      value: String(todayVisits.length),
      change: todayVisits.length
        ? "По актуальному расписанию"
        : "Выездов пока нет",
      tone: "warning" as const,
      bars: dailyVisitBars,
    },
    {
      label: "Нужны решения",
      value: String(attentionCount),
      change: overdueCount
        ? `${overdueCount} просрочено`
        : ordersInApproval
          ? `${ordersInApproval} на согласовании`
          : "Критичных блокеров нет",
      tone: "danger" as const,
      bars: dailyTaskBars,
    },
    {
      label: "Заказы в работе",
      value: String(activeOrders.length),
      change: `${unassignedActiveOrders} без мастера`,
      tone: "accent" as const,
      bars: dailyOrderBars,
    },
    {
      label: "Согласовано за месяц",
      value: formatMoneyMinor(currentMonthAgreed),
      change: `${currentMonthOrders.length} новых заказов`,
      tone: "support" as const,
      bars: dailyOrderBars,
    },
  ];
  const routeDescription = todayVisits.length
    ? `Сегодня · ${formatDashboardDate(now, dashboardTimeZone)}`
    : "Ближайшие даты";
  return (
    <div className="figma-report-page dashboard-figma-page animate-rise">
      <header className="dashboard-figma-header">
        <p className="figma-report-kicker">Оперативный контур / Local CRM</p>
        <h1 className="figma-report-title mt-[9px]">Сегодня в работе</h1>
        <p className="figma-report-description mt-[6px]">
          Сегодня: {todayVisits.length} выездов по расписанию и {overdueTaskCount} просроченные задачи.
        </p>
        <p className="dashboard-mobile-date">{formatLongDashboardDate(now, dashboardTimeZone)}</p>
        <DashboardDateCard initialNow={now.toISOString()} />
      </header>

      <section aria-labelledby="dashboard-pulse-heading" className="dashboard-open-metrics">
        <h2 id="dashboard-pulse-heading" className="sr-only">
          Пульс дня
        </h2>
        {metrics.map((metric, index) => (
          <article key={metric.label}>
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
            <div className="dashboard-metric-footer" data-stacked={index === 1 || index === 2}>
              <span>{metric.change}</span>
              {index === 0 ? <div className="dashboard-metric-bars" aria-hidden="true">{metric.bars.map((value, barIndex) => <i key={barIndex} style={{ height: `${Math.max(9, value * 7)}px` }} />)}</div> : null}
              {index === 1 || index === 2 ? <div className="dashboard-metric-units" aria-hidden="true">{Array.from({ length: 10 }, (_, unitIndex) => <i key={unitIndex} data-filled={unitIndex < (index === 1 ? attentionCount : activeOrders.length)} />)}</div> : null}
            </div>
          </article>
        ))}
      </section>

      <div className="dashboard-operational-row">
        <div id="dashboard-route"><TodayVisits visits={routeVisits} dateLabel={routeDescription} title={todayVisits.length ? "Маршрут на сегодня" : "Ближайшие выезды"} /></div>
        <div id="dashboard-tasks"><TaskList tasks={visibleTasks.slice(0, 2)} canWrite={!preview && hasPermission(member, "tasks.write")} /></div>
      </div>

      <div id="dashboard-activity">
        <ActivityChart points={activityCounts.map((count, index) => ({ date: new Date(new Date(`${initialCalendarDate}T00:00:00Z`).getTime() - (29 - index) * 86_400_000).toISOString().slice(0, 10), count }))} />
      </div>

      <div id="dashboard-orders" className="dashboard-orders-block">
        <RecentOrders orders={dashboardOrders.slice(0, 6)} />
      </div>

      <div className="dashboard-planning-row">
        <div id="dashboard-calendar">
          <DashboardCalendar visits={calendarVisits} initialDate={initialCalendarDate} />
        </div>
        <div id="dashboard-finance">
          <FinancialSummary orders={currentMonthOrders} />
        </div>
      </div>
    </div>
  );
}

function taskUrgency(task: {
  column: "overdue" | "today" | "upcoming" | "unscheduled";
  priority: "low" | "normal" | "high" | "critical";
}) {
  const columnRank = {
    overdue: 0,
    today: 1,
    upcoming: 2,
    unscheduled: 3,
  } as const;
  const priorityRank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
  return columnRank[task.column] * 4 + priorityRank[task.priority];
}

function formatDashboardDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatLongDashboardDate(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function countsByDate(dateKeys: string[], endDate: string, days = 7) {
  const end = new Date(`${endDate}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end.getTime() - (days - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return dateKeys.filter((value) => value === date).length;
  });
}

const visitColors: Record<VisitStatus, DashboardVisit["tone"]> = {
  planned: "warning",
  confirmed: "support",
  in_progress: "accent",
  completed: "success",
  cancelled: "danger",
};

function localDateKey(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
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
    tone: visitColors[visit.statusCode],
  };
}
