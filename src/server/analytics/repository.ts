import "server-only";

import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { createAnalyticsBuckets, describeChange } from "./calculations";
import type { AnalyticsMetric, AnalyticsRange, AnalyticsSnapshot } from "./types";

const boundsRowSchema = z.object({
  timezone: z.string(),
  current_start_at: z.coerce.date(),
  current_end_at: z.coerce.date(),
  previous_start_at: z.coerce.date(),
  start_date: z.string(),
  end_date: z.string(),
});
const orderMetricsRowSchema = z.object({
  current_orders: z.number().int().nonnegative(),
  previous_orders: z.number().int().nonnegative(),
  current_agreed: z.string(),
  previous_agreed: z.string(),
  current_paid: z.string(),
  previous_paid: z.string(),
});
const countMetricsRowSchema = z.object({ current_count: z.number().int().nonnegative(), previous_count: z.number().int().nonnegative() });
const visitMetricsRowSchema = countMetricsRowSchema.extend({ current_completed: z.number().int().nonnegative() });
const trendRowSchema = z.object({ bucket_date: z.string(), agreed_minor: z.string(), paid_minor: z.string(), operating_minor: z.string() });
const stagesRowSchema = z.object({ created: z.number().int().nonnegative(), approved: z.number().int().nonnegative(), scheduled: z.number().int().nonnegative(), completed: z.number().int().nonnegative() });
const serviceRowSchema = z.object({ label: z.string(), amount_minor: z.string() });
const teamRowSchema = z.object({ id: z.string().uuid(), name: z.string(), visits: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), order_value_minor: z.string() });
const clientRowSchema = z.object({ id: z.string().uuid(), name: z.string(), orders: z.number().int().positive(), agreed_minor: z.string() });
const rateRowSchema = z.object({ repeat_clients: z.number().int().nonnegative(), active_clients: z.number().int().nonnegative() });

const serviceColors = ["#000000", "#a2beff", "#25272c", "#f6f5f0"];

function safeInteger(value: string | number | bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("Analytics value exceeds the supported UI range.");
  return result;
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function metric(id: AnalyticsMetric["id"], label: string, value: number, previous: number, format: AnalyticsMetric["format"], tone: AnalyticsMetric["tone"]): AnalyticsMetric {
  return { id, label, value, format, tone, change: describeChange(value, previous) };
}

export async function getAnalyticsSnapshot(member: AuthenticatedMember, rangeDays: AnalyticsRange): Promise<AnalyticsSnapshot> {
  requirePermission(member, "analytics.read");
  const sql = getDatabase();
  const [boundsRow] = await sql`SELECT timezone,
    ((((now() AT TIME ZONE timezone)::date - (${rangeDays} - 1))::timestamp) AT TIME ZONE timezone) AS current_start_at,
    ((((now() AT TIME ZONE timezone)::date + 1)::timestamp) AT TIME ZONE timezone) AS current_end_at,
    ((((now() AT TIME ZONE timezone)::date - (${rangeDays} * 2 - 1))::timestamp) AT TIME ZONE timezone) AS previous_start_at,
    ((now() AT TIME ZONE timezone)::date - (${rangeDays} - 1))::text AS start_date,
    (now() AT TIME ZONE timezone)::date::text AS end_date
    FROM organizations WHERE id = ${member.organizationId}`;
  const bounds = boundsRowSchema.parse(boundsRow);
  const bucketUnit = rangeDays === 30 ? "day" : rangeDays === 90 ? "week" : "month";

  const [orderMetricRows, visitMetricRows, clientMetricRows, trendRows, stageRows, serviceRows, teamRows, clientRows, repeatRateRows] = await Promise.all([
    sql`SELECT
      count(*) FILTER (WHERE created_at >= ${bounds.current_start_at})::integer AS current_orders,
      count(*) FILTER (WHERE created_at < ${bounds.current_start_at})::integer AS previous_orders,
      coalesce(sum(agreed_total_minor) FILTER (WHERE created_at >= ${bounds.current_start_at} AND status <> 'cancelled'), 0)::text AS current_agreed,
      coalesce(sum(agreed_total_minor) FILTER (WHERE created_at < ${bounds.current_start_at} AND status <> 'cancelled'), 0)::text AS previous_agreed,
      coalesce(sum(paid_total_minor) FILTER (WHERE created_at >= ${bounds.current_start_at} AND status <> 'cancelled'), 0)::text AS current_paid,
      coalesce(sum(paid_total_minor) FILTER (WHERE created_at < ${bounds.current_start_at} AND status <> 'cancelled'), 0)::text AS previous_paid
      FROM orders WHERE organization_id = ${member.organizationId}
        AND created_at >= ${bounds.previous_start_at} AND created_at < ${bounds.current_end_at}`,
    sql`SELECT
      count(*) FILTER (WHERE scheduled_start_at >= ${bounds.current_start_at})::integer AS current_count,
      count(*) FILTER (WHERE scheduled_start_at < ${bounds.current_start_at})::integer AS previous_count,
      count(*) FILTER (WHERE scheduled_start_at >= ${bounds.current_start_at} AND status = 'completed')::integer AS current_completed
      FROM service_visits WHERE organization_id = ${member.organizationId}
        AND scheduled_start_at >= ${bounds.previous_start_at} AND scheduled_start_at < ${bounds.current_end_at}`,
    sql`SELECT
      count(*) FILTER (WHERE created_at >= ${bounds.current_start_at})::integer AS current_count,
      count(*) FILTER (WHERE created_at < ${bounds.current_start_at})::integer AS previous_count
      FROM clients WHERE organization_id = ${member.organizationId}
        AND created_at >= ${bounds.previous_start_at} AND created_at < ${bounds.current_end_at}`,
    sql`WITH expense_totals AS (
      SELECT order_id, sum(amount_minor)::bigint AS amount_minor FROM order_expenses
      WHERE organization_id = ${member.organizationId} GROUP BY order_id
    ) SELECT date_trunc(${bucketUnit}, orders.created_at AT TIME ZONE ${bounds.timezone})::date::text AS bucket_date,
      sum(orders.agreed_total_minor)::text AS agreed_minor,
      sum(orders.paid_total_minor)::text AS paid_minor,
      sum(orders.agreed_total_minor - coalesce(orders.master_payment_snapshot_minor, 0) - coalesce(expense_totals.amount_minor, 0))::text AS operating_minor
      FROM orders LEFT JOIN expense_totals ON expense_totals.order_id = orders.id
      WHERE orders.organization_id = ${member.organizationId} AND orders.status <> 'cancelled'
        AND orders.created_at >= ${bounds.current_start_at} AND orders.created_at < ${bounds.current_end_at}
      GROUP BY bucket_date ORDER BY bucket_date`,
    sql`SELECT count(*)::integer AS created,
      count(*) FILTER (WHERE status NOT IN ('new', 'cancelled'))::integer AS approved,
      count(*) FILTER (WHERE status IN ('scheduled', 'in_progress', 'overdue', 'completed'))::integer AS scheduled,
      count(*) FILTER (WHERE status = 'completed')::integer AS completed
      FROM orders WHERE organization_id = ${member.organizationId}
        AND created_at >= ${bounds.current_start_at} AND created_at < ${bounds.current_end_at}`,
    sql`SELECT order_services.service_name_snapshot AS label, sum(order_services.line_total_minor)::text AS amount_minor
      FROM order_services JOIN orders ON orders.organization_id = order_services.organization_id AND orders.id = order_services.order_id
      WHERE orders.organization_id = ${member.organizationId} AND orders.status <> 'cancelled'
        AND orders.created_at >= ${bounds.current_start_at} AND orders.created_at < ${bounds.current_end_at}
      GROUP BY order_services.service_name_snapshot ORDER BY sum(order_services.line_total_minor) DESC LIMIT 7`,
    sql`WITH order_values AS (
      SELECT assigned_master_id, sum(agreed_total_minor)::bigint AS amount_minor FROM orders
      WHERE organization_id = ${member.organizationId} AND assigned_master_id IS NOT NULL AND status <> 'cancelled'
        AND created_at >= ${bounds.current_start_at} AND created_at < ${bounds.current_end_at}
      GROUP BY assigned_master_id
    ) SELECT service_visits.assigned_master_id AS id,
      coalesce(max(service_visits.master_name_snapshot), max(masters.full_name)) AS name,
      count(*)::integer AS visits,
      count(*) FILTER (WHERE service_visits.status = 'completed')::integer AS completed,
      coalesce(max(order_values.amount_minor), 0)::text AS order_value_minor
      FROM service_visits
      LEFT JOIN masters ON masters.organization_id = service_visits.organization_id AND masters.id = service_visits.assigned_master_id
      LEFT JOIN order_values ON order_values.assigned_master_id = service_visits.assigned_master_id
      WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.assigned_master_id IS NOT NULL
        AND service_visits.status <> 'cancelled' AND service_visits.scheduled_start_at >= ${bounds.current_start_at}
        AND service_visits.scheduled_start_at < ${bounds.current_end_at}
      GROUP BY service_visits.assigned_master_id ORDER BY visits DESC LIMIT 8`,
    sql`SELECT clients.id, clients.legal_name AS name, count(orders.id)::integer AS orders,
      sum(orders.agreed_total_minor)::text AS agreed_minor
      FROM orders JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
      WHERE orders.organization_id = ${member.organizationId} AND orders.status <> 'cancelled'
        AND orders.created_at >= ${bounds.current_start_at} AND orders.created_at < ${bounds.current_end_at}
      GROUP BY clients.id, clients.legal_name ORDER BY sum(orders.agreed_total_minor) DESC LIMIT 6`,
    sql`WITH client_orders AS (
      SELECT client_id, count(*)::integer AS order_count FROM orders
      WHERE organization_id = ${member.organizationId} AND status <> 'cancelled'
        AND created_at >= ${bounds.current_start_at} AND created_at < ${bounds.current_end_at}
      GROUP BY client_id
    ) SELECT count(*) FILTER (WHERE order_count > 1)::integer AS repeat_clients,
      count(*)::integer AS active_clients FROM client_orders`,
  ]);

  const orders = orderMetricsRowSchema.parse(orderMetricRows[0]);
  const visits = visitMetricsRowSchema.parse(visitMetricRows[0]);
  const clients = countMetricsRowSchema.parse(clientMetricRows[0]);
  const currentAgreed = safeInteger(orders.current_agreed);
  const previousAgreed = safeInteger(orders.previous_agreed);
  const currentPaid = safeInteger(orders.current_paid);
  const previousPaid = safeInteger(orders.previous_paid);
  const currentAverage = orders.current_orders ? Math.round(currentAgreed / orders.current_orders) : 0;
  const previousAverage = orders.previous_orders ? Math.round(previousAgreed / orders.previous_orders) : 0;

  const buckets = createAnalyticsBuckets(bounds.start_date, bounds.end_date, rangeDays);
  const trendByBucket = new Map(trendRows.map((row) => {
    const entry = trendRowSchema.parse(row);
    return [entry.bucket_date, entry] as const;
  }));
  const trendValues = (field: "agreed_minor" | "paid_minor" | "operating_minor") => buckets.map((bucket) => safeInteger(trendByBucket.get(bucket.key)?.[field] ?? 0) / 100);
  const stages = stagesRowSchema.parse(stageRows[0]);
  const parsedServices = serviceRows.map((row) => serviceRowSchema.parse(row));
  const serviceTotal = parsedServices.reduce((total, service) => total + safeInteger(service.amount_minor), 0);
  const parsedTeam = teamRows.map((row) => teamRowSchema.parse(row));
  const repeatRates = rateRowSchema.parse(repeatRateRows[0]);
  const currentVisitCount = visits.current_count;

  return {
    range: { days: rangeDays, startDate: bounds.start_date, endDate: bounds.end_date, timezone: bounds.timezone },
    metrics: [
      metric("agreed", "Согласовано", currentAgreed, previousAgreed, "money", "lime"),
      metric("paid", "Получено", currentPaid, previousPaid, "money", "mint"),
      metric("orders", "Новых заказов", orders.current_orders, orders.previous_orders, "integer", "violet"),
      metric("visits", "Выездов", visits.current_count, visits.previous_count, "integer", "amber"),
      metric("clients", "Новых клиентов", clients.current_count, clients.previous_count, "integer", "mint"),
      metric("average_order", "Средний чек", currentAverage, previousAverage, "money", "violet"),
    ],
    financialTrend: {
      labels: buckets.map((bucket) => bucket.label),
      series: [
        { label: "Согласовано", color: "#000000", values: trendValues("agreed_minor"), valueFormat: "money" },
        { label: "Плановый опер. остаток", color: "#a2beff", values: trendValues("operating_minor"), valueFormat: "money" },
        { label: "Получено", color: "#25272c", values: trendValues("paid_minor"), valueFormat: "money" },
      ],
    },
    orderStages: [
      { label: "Создано", value: stages.created, percent: stages.created ? 100 : 0 },
      { label: "Прошли согласование", value: stages.approved, percent: percentage(stages.approved, stages.created) },
      { label: "Назначены в работу", value: stages.scheduled, percent: percentage(stages.scheduled, stages.created) },
      { label: "Выполнены", value: stages.completed, percent: percentage(stages.completed, stages.created) },
    ],
    serviceMix: parsedServices.map((service, index) => ({
      label: service.label,
      amountMinor: safeInteger(service.amount_minor),
      percent: percentage(safeInteger(service.amount_minor), serviceTotal),
      color: serviceColors[index % serviceColors.length],
    })),
    teamPerformance: parsedTeam.map((entry) => ({
      id: entry.id,
      name: entry.name,
      visits: entry.visits,
      completion: percentage(entry.completed, entry.visits),
      orderValueMinor: safeInteger(entry.order_value_minor),
    })),
    topClients: clientRows.map((row) => {
      const client = clientRowSchema.parse(row);
      return { id: client.id, name: client.name, orders: client.orders, agreedMinor: safeInteger(client.agreed_minor) };
    }),
    repeatClientRate: percentage(repeatRates.repeat_clients, repeatRates.active_clients),
    completedVisitRate: percentage(visits.current_completed, currentVisitCount),
  };
}

export async function recordAnalyticsExport(member: AuthenticatedMember, rangeDays: AnalyticsRange) {
  requirePermission(member, "analytics.read");
  const sql = getDatabase();
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'analytics.export', 'organization', ${member.organizationId}, ${sql.json({ rangeDays, format: "csv" })})`;
}
