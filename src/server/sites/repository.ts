import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { selectCanonicalWebsiteMetrics, type WebsiteMetricRow } from "./metrics";
import type { ConfigureWebsiteIntegrationInput, CreateWebsiteInput, UpdateWebsiteInfrastructureInput } from "./schemas";
import type { WebsiteDetail, WebsiteHealthSnapshot, WebsiteIntegrationListItem, WebsiteListItem, WebsiteSnapshot } from "./types";

const websiteRowSchema = z.object({ id: z.string().uuid(), name: z.string(), domain: z.string(), status: z.enum(["setup", "active", "attention", "disabled"]), version: z.number().int().positive() });
const integrationRowSchema = z.object({ id: z.string().uuid(), website_id: z.string().uuid(), provider: z.enum(["yandex_metrica", "ga4", "google_search_console", "yandex_webmaster"]), external_property_id: z.string(), status: z.enum(["pending", "connected", "error", "revoked"]), last_successful_sync_at: z.coerce.date().nullable(), last_error_code: z.string().nullable() });
const metricRowSchema = z.object({ website_id: z.string().uuid(), metric_date: z.string(), provider: z.enum(["yandex_metrica", "ga4", "google_search_console", "yandex_webmaster", "crm"]), visitors: z.string(), sessions: z.string(), pageviews: z.string(), goal_completions: z.string(), search_clicks: z.string(), search_impressions: z.string() });
const leadRowSchema = z.object({ website_id: z.string().uuid(), leads: z.number().int().nonnegative(), paid_orders: z.number().int().nonnegative(), paid_revenue_minor: z.string() });
const sourceRowSchema = z.object({ source: z.string(), leads: z.number().int().positive() });
const boundsRowSchema = z.object({ timezone: z.string(), start_date: z.string(), end_date: z.string(), start_at: z.coerce.date(), end_at: z.coerce.date() });
const hostingRowSchema = z.object({ provider: z.string(), plan_name: z.string(), server_region: z.string(), monthly_cost_minor: z.string(), renewal_on: z.string(), ssl_expires_on: z.string(), disk_capacity_mb: z.number().int().positive(), memory_capacity_mb: z.number().int().positive(), notes: z.string().nullable() });
const healthRowSchema = z.object({ id: z.string().uuid(), measured_at: z.coerce.date(), health_status: z.enum(["healthy", "degraded", "down"]), uptime_percent: z.coerce.number(), response_time_ms: z.number().int().nonnegative(), cpu_load_percent: z.coerce.number(), memory_used_mb: z.number().int().nonnegative(), disk_used_mb: z.number().int().nonnegative(), source: z.enum(["manual", "monitor"]) });

export class WebsiteDomainConflictError extends Error { constructor() { super("Website domain already exists."); this.name = "WebsiteDomainConflictError"; } }
export class WebsiteNotFoundError extends Error { constructor() { super("Website was not found."); this.name = "WebsiteNotFoundError"; } }
export class WebsiteIntegrationConflictError extends Error { constructor() { super("Website provider is already configured."); this.name = "WebsiteIntegrationConflictError"; } }
export class WebsiteVersionConflictError extends Error { constructor() { super("Website was changed by another user."); this.name = "WebsiteVersionConflictError"; } }

function constraintName(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23505") return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function safeInteger(value: string | number | bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError("Website metric exceeds the supported UI range.");
  return result;
}

function formatDateLabel(date: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)).replace(".", "");
}

function mapHealthSnapshot(value: unknown): WebsiteHealthSnapshot {
  const row = healthRowSchema.parse(value);
  return { id: row.id, measuredAt: row.measured_at.toISOString(), healthStatus: row.health_status, uptimePercent: row.uptime_percent, responseTimeMs: row.response_time_ms, cpuLoadPercent: row.cpu_load_percent, memoryUsedMb: row.memory_used_mb, diskUsedMb: row.disk_used_mb, source: row.source };
}

export async function getWebsiteSnapshot(member: AuthenticatedMember): Promise<WebsiteSnapshot> {
  requirePermission(member, "sites.read");
  const sql = getDatabase();
  const [boundsValue] = await sql`SELECT timezone,
      ((now() AT TIME ZONE timezone)::date - 29)::text AS start_date,
      (now() AT TIME ZONE timezone)::date::text AS end_date,
      ((((now() AT TIME ZONE timezone)::date - 29)::timestamp) AT TIME ZONE timezone) AS start_at,
      ((((now() AT TIME ZONE timezone)::date + 1)::timestamp) AT TIME ZONE timezone) AS end_at
    FROM organizations WHERE id = ${member.organizationId}`;
  const bounds = boundsRowSchema.parse(boundsValue);
  const [websiteValues, integrationValues, metricValues, leadValues, sourceValues] = await Promise.all([
    sql`SELECT id, name, domain, status, version FROM websites WHERE organization_id = ${member.organizationId} ORDER BY created_at DESC`,
    sql`SELECT id, website_id, provider, external_property_id, status, last_successful_sync_at, last_error_code
      FROM website_integrations WHERE organization_id = ${member.organizationId} ORDER BY created_at`,
    sql`SELECT website_id, metric_date::text, provider, visitors::text, sessions::text, pageviews::text,
        goal_completions::text, search_clicks::text, search_impressions::text
      FROM website_daily_metrics WHERE organization_id = ${member.organizationId}
        AND metric_date BETWEEN ${bounds.start_date}::date AND ${bounds.end_date}::date ORDER BY metric_date`,
    sql`SELECT website_leads.website_id, count(DISTINCT website_leads.id)::integer AS leads,
        count(DISTINCT orders.id) FILTER (WHERE orders.paid_total_minor > 0)::integer AS paid_orders,
        coalesce(sum(orders.paid_total_minor), 0)::text AS paid_revenue_minor
      FROM website_leads LEFT JOIN orders ON orders.organization_id = website_leads.organization_id AND orders.source_lead_id = website_leads.id
      WHERE website_leads.organization_id = ${member.organizationId} AND website_leads.received_at >= ${bounds.start_at}
        AND website_leads.received_at < ${bounds.end_at}
      GROUP BY website_leads.website_id`,
    sql`SELECT coalesce(nullif(btrim(utm_source), ''), 'Без метки') AS source, count(*)::integer AS leads
      FROM website_leads WHERE organization_id = ${member.organizationId} AND received_at >= ${bounds.start_at}
        AND received_at < ${bounds.end_at}
      GROUP BY source ORDER BY leads DESC, source LIMIT 6`,
  ]);

  const websiteRows = websiteValues.map((value) => websiteRowSchema.parse(value));
  const integrationsByWebsite = new Map<string, WebsiteIntegrationListItem[]>();
  for (const value of integrationValues) {
    const row = integrationRowSchema.parse(value);
    const integration: WebsiteIntegrationListItem = { id: row.id, provider: row.provider, propertyId: row.external_property_id, status: row.status, lastSuccessfulSyncAt: row.last_successful_sync_at?.toISOString() ?? null, lastErrorCode: row.last_error_code };
    integrationsByWebsite.set(row.website_id, [...(integrationsByWebsite.get(row.website_id) ?? []), integration]);
  }
  const metricRows: WebsiteMetricRow[] = metricValues.map((value) => {
    const row = metricRowSchema.parse(value);
    return { websiteId: row.website_id, date: row.metric_date, provider: row.provider, visitors: safeInteger(row.visitors), sessions: safeInteger(row.sessions), pageviews: safeInteger(row.pageviews), goalCompletions: safeInteger(row.goal_completions), searchClicks: safeInteger(row.search_clicks), searchImpressions: safeInteger(row.search_impressions) };
  });
  const canonical = selectCanonicalWebsiteMetrics(metricRows);
  const trafficByWebsite = new Map<string, { visitors: number; pageviews: number }>();
  const trafficByDate = new Map<string, { visitors: number; pageviews: number }>();
  for (const row of canonical.traffic) {
    const site = trafficByWebsite.get(row.websiteId) ?? { visitors: 0, pageviews: 0 };
    site.visitors += row.visitors; site.pageviews += row.pageviews; trafficByWebsite.set(row.websiteId, site);
    const day = trafficByDate.get(row.date) ?? { visitors: 0, pageviews: 0 };
    day.visitors += row.visitors; day.pageviews += row.pageviews; trafficByDate.set(row.date, day);
  }
  const leadByWebsite = new Map(leadValues.map((value) => { const row = leadRowSchema.parse(value); return [row.website_id, { leads: row.leads, paidOrders: row.paid_orders, paidRevenueMinor: safeInteger(row.paid_revenue_minor) }] as const; }));
  const sites: WebsiteListItem[] = websiteRows.map((row) => {
    const traffic = trafficByWebsite.get(row.id) ?? { visitors: 0, pageviews: 0 };
    const funnel = leadByWebsite.get(row.id) ?? { leads: 0, paidOrders: 0, paidRevenueMinor: 0 };
    return { id: row.id, name: row.name, domain: row.domain, status: row.status, version: row.version, ...traffic, ...funnel, conversionPercent: traffic.visitors ? Number(((funnel.leads / traffic.visitors) * 100).toFixed(2)) : 0, integrations: integrationsByWebsite.get(row.id) ?? [] };
  });
  const dates: string[] = [];
  const cursor = new Date(`${bounds.start_date}T00:00:00Z`);
  const end = new Date(`${bounds.end_date}T00:00:00Z`);
  while (cursor <= end) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  const searchClicks = [...canonical.search.values()].reduce((total, value) => total + value.clicks, 0);
  const searchClicksByDate = new Map<string, number>();
  for (const [key, value] of canonical.search) {
    const date = key.slice(key.lastIndexOf(":") + 1);
    searchClicksByDate.set(date, (searchClicksByDate.get(date) ?? 0) + value.clicks);
  }
  const visitors = sites.reduce((total, site) => total + site.visitors, 0);
  const pageviews = sites.reduce((total, site) => total + site.pageviews, 0);
  const leads = sites.reduce((total, site) => total + site.leads, 0);
  const paidOrders = sites.reduce((total, site) => total + site.paidOrders, 0);
  const sources = sourceValues.map((value) => sourceRowSchema.parse(value));
  const sourceTotal = sources.reduce((total, source) => total + source.leads, 0);
  return {
    period: { startDate: bounds.start_date, endDate: bounds.end_date, timezone: bounds.timezone },
    summary: { totalSites: sites.length, activeSites: sites.filter((site) => site.status === "active").length, visitors, pageviews, searchClicks, leads, paidOrders, paidRevenueMinor: sites.reduce((total, site) => total + site.paidRevenueMinor, 0), conversionPercent: visitors ? Number(((leads / visitors) * 100).toFixed(2)) : 0 },
    sites,
    trafficTrend: { labels: dates.map(formatDateLabel), series: [
      { label: "Посетители", color: "#edf43b", values: dates.map((date) => trafficByDate.get(date)?.visitors ?? 0), valueFormat: "integer" },
      { label: "Просмотры", color: "#65b7ee", values: dates.map((date) => trafficByDate.get(date)?.pageviews ?? 0), valueFormat: "integer" },
      { label: "Поисковые клики", color: "#9c82e8", values: dates.map((date) => searchClicksByDate.get(date) ?? 0), valueFormat: "integer" },
    ] },
    trafficSources: sources.map((source) => ({ label: source.source, amount: source.leads, value: sourceTotal ? Math.round((source.leads / sourceTotal) * 100) : 0 })),
  };
}

export async function createWebsite(member: AuthenticatedMember, input: CreateWebsiteInput) {
  requirePermission(member, "sites.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const request = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'website.create') ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!request.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "website.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      const [website] = await transaction`INSERT INTO websites (organization_id, name, domain, status) VALUES (${member.organizationId}, ${input.name}, ${input.domain}, 'setup') RETURNING id`;
      const websiteId = z.string().uuid().parse(website.id);
      await transaction`UPDATE idempotency_requests SET entity_id = ${websiteId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'website.create', 'website', ${websiteId}, ${transaction.json({ name: input.name, domain: input.domain, status: "setup" })})`;
      return websiteId;
    });
  } catch (error) {
    if (constraintName(error) === "websites_organization_id_domain_key") throw new WebsiteDomainConflictError();
    throw error;
  }
}

export async function getWebsiteDetail(member: AuthenticatedMember, websiteId: string): Promise<WebsiteDetail> {
  requirePermission(member, "sites.read");
  const parsedWebsiteId = z.string().uuid().parse(websiteId);
  const snapshot = await getWebsiteSnapshot(member);
  const website = snapshot.sites.find((site) => site.id === parsedWebsiteId);
  if (!website) throw new WebsiteNotFoundError();
  const sql = getDatabase();
  const [hostingRows, healthRows] = await Promise.all([
    sql`SELECT provider, plan_name, server_region, monthly_cost_minor::text, renewal_on::text, ssl_expires_on::text,
        disk_capacity_mb, memory_capacity_mb, notes
      FROM website_hosting_profiles WHERE organization_id = ${member.organizationId} AND website_id = ${parsedWebsiteId}`,
    sql`SELECT id, measured_at, health_status, uptime_percent::text, response_time_ms, cpu_load_percent::text,
        memory_used_mb, disk_used_mb, source
      FROM website_health_snapshots WHERE organization_id = ${member.organizationId} AND website_id = ${parsedWebsiteId}
      ORDER BY measured_at DESC LIMIT 30`,
  ]);
  const hostingRow = hostingRows[0] ? hostingRowSchema.parse(hostingRows[0]) : null;
  const healthHistory = healthRows.map(mapHealthSnapshot);
  return {
    ...website,
    timezone: snapshot.period.timezone,
    hosting: hostingRow ? {
      provider: hostingRow.provider,
      planName: hostingRow.plan_name,
      serverRegion: hostingRow.server_region,
      monthlyCostMinor: safeInteger(hostingRow.monthly_cost_minor),
      renewalOn: hostingRow.renewal_on,
      sslExpiresOn: hostingRow.ssl_expires_on,
      diskCapacityMb: hostingRow.disk_capacity_mb,
      memoryCapacityMb: hostingRow.memory_capacity_mb,
      notes: hostingRow.notes,
    } : null,
    health: healthHistory[0] ?? null,
    healthHistory,
  };
}

export async function updateWebsiteInfrastructure(member: AuthenticatedMember, input: UpdateWebsiteInfrastructureInput) {
  requirePermission(member, "sites.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [current] = await transaction`SELECT status, version FROM websites
      WHERE organization_id = ${member.organizationId} AND id = ${input.websiteId} FOR UPDATE`;
    if (!current) throw new WebsiteNotFoundError();
    const currentWebsite = z.object({ status: z.enum(["setup", "active", "attention", "disabled"]), version: z.number().int().positive() }).parse(current);
    if (currentWebsite.version !== input.expectedVersion) throw new WebsiteVersionConflictError();

    await transaction`INSERT INTO website_hosting_profiles
      (organization_id, website_id, provider, plan_name, server_region, monthly_cost_minor, renewal_on, ssl_expires_on,
        disk_capacity_mb, memory_capacity_mb, notes, updated_by)
      VALUES (${member.organizationId}, ${input.websiteId}, ${input.hostingProvider}, ${input.planName}, ${input.serverRegion},
        ${input.monthlyCostMinor}, ${input.renewalOn}, ${input.sslExpiresOn}, ${input.diskCapacityMb}, ${input.memoryCapacityMb},
        ${input.notes}, ${member.memberId})
      ON CONFLICT (organization_id, website_id) DO UPDATE SET provider = EXCLUDED.provider, plan_name = EXCLUDED.plan_name,
        server_region = EXCLUDED.server_region, monthly_cost_minor = EXCLUDED.monthly_cost_minor, renewal_on = EXCLUDED.renewal_on,
        ssl_expires_on = EXCLUDED.ssl_expires_on, disk_capacity_mb = EXCLUDED.disk_capacity_mb,
        memory_capacity_mb = EXCLUDED.memory_capacity_mb, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    const [health] = await transaction`INSERT INTO website_health_snapshots
      (organization_id, website_id, health_status, uptime_percent, response_time_ms, cpu_load_percent,
        memory_used_mb, disk_used_mb, source, created_by)
      VALUES (${member.organizationId}, ${input.websiteId}, ${input.healthStatus}, ${input.uptimePercent}, ${input.responseTimeMs},
        ${input.cpuLoadPercent}, ${input.memoryUsedMb}, ${input.diskUsedMb}, 'manual', ${member.memberId}) RETURNING id`;
    const [updated] = await transaction`UPDATE websites SET status = ${input.status}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.websiteId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updated) throw new WebsiteVersionConflictError();
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'website.infrastructure_update', 'website', ${input.websiteId},
        ${transaction.json({ before: { status: currentWebsite.status, version: currentWebsite.version }, after: { status: input.status, hostingProvider: input.hostingProvider, planName: input.planName, renewalOn: input.renewalOn, sslExpiresOn: input.sslExpiresOn, healthStatus: input.healthStatus, healthSnapshotId: health.id, version: updated.version } })})`;
    return z.number().int().positive().parse(updated.version);
  });
}

export async function configureWebsiteIntegration(member: AuthenticatedMember, input: ConfigureWebsiteIntegrationInput) {
  requirePermission(member, "sites.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const request = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'website.integration.configure') ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!request.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "website.integration.configure" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      const [website] = await transaction`SELECT id, status FROM websites WHERE organization_id = ${member.organizationId} AND id = ${input.websiteId} FOR UPDATE`;
      if (!website || website.status === "disabled") throw new WebsiteNotFoundError();
      const [integration] = await transaction`INSERT INTO website_integrations (organization_id, website_id, provider, external_property_id, credential_secret_reference, status)
        VALUES (${member.organizationId}, ${input.websiteId}, ${input.provider}, ${input.propertyId}, ${input.secretReference}, 'pending') RETURNING id`;
      const integrationId = z.string().uuid().parse(integration.id);
      await transaction`UPDATE websites SET updated_at = now(), version = version + 1 WHERE organization_id = ${member.organizationId} AND id = ${input.websiteId}`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${integrationId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'website.integration.configure', 'website_integration', ${integrationId},
          ${transaction.json({ websiteId: input.websiteId, provider: input.provider, propertyId: input.propertyId, status: "pending" })})`;
      return integrationId;
    });
  } catch (error) {
    if (constraintName(error) === "website_integrations_organization_id_website_id_provider_key") throw new WebsiteIntegrationConflictError();
    throw error;
  }
}
