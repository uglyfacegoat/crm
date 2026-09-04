import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { normalizeContactPhone } from "@/server/clients/phone";
import { getDatabase } from "@/server/database";
import type { IncomingLead, IncomingLeadPrefill, IncomingLeadSnapshot } from "./types";
import type { IncomingLeadListFilter, RejectIncomingLeadInput, WebsiteLeadWebhookInput } from "./schemas";

const leadRowSchema = z.object({
  id: z.string().uuid(),
  website_id: z.string().uuid(),
  website_name: z.string(),
  website_domain: z.string(),
  external_event_id: z.string(),
  received_at: z.coerce.date(),
  contact_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  service_interest: z.string().nullable(),
  landing_url: z.string().nullable(),
  utm_source: z.string().nullable(),
  utm_campaign: z.string().nullable(),
  moderation_status: z.enum(["new", "reviewing", "accepted", "rejected"]),
  review_note: z.string().nullable(),
  reviewer_name: z.string().nullable(),
  reviewed_at: z.coerce.date().nullable(),
  version: z.number().int().positive(),
  order_id: z.string().uuid().nullable(),
  order_number: z.string().nullable(),
  possible_client_id: z.string().uuid().nullable(),
  possible_client_name: z.string().nullable(),
});

const countRowSchema = z.object({ status: z.enum(["new", "reviewing", "accepted", "rejected"]), count: z.number().int().nonnegative() });
const leadPrefillRowSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  contact_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  service_interest: z.string().nullable(),
  website_name: z.string(),
  landing_url: z.string().nullable(),
  utm_source: z.string().nullable(),
  utm_campaign: z.string().nullable(),
  possible_client_id: z.string().uuid().nullable(),
});

export class IncomingLeadNotFoundError extends Error {
  constructor() { super("Incoming lead was not found."); this.name = "IncomingLeadNotFoundError"; }
}

export class IncomingLeadConflictError extends Error {
  constructor() { super("Incoming lead was changed or already processed."); this.name = "IncomingLeadConflictError"; }
}

export class IncomingLeadRateLimitError extends Error {
  constructor() { super("The website lead rate limit was exceeded."); this.name = "IncomingLeadRateLimitError"; }
}

function mapLead(value: unknown): IncomingLead {
  const row = leadRowSchema.parse(value);
  return {
    id: row.id,
    websiteId: row.website_id,
    websiteName: row.website_name,
    websiteDomain: row.website_domain,
    externalEventId: row.external_event_id,
    receivedAt: row.received_at.toISOString(),
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    serviceInterest: row.service_interest,
    landingUrl: row.landing_url,
    utmSource: row.utm_source,
    utmCampaign: row.utm_campaign,
    status: row.moderation_status,
    reviewNote: row.review_note,
    reviewerName: row.reviewer_name,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    version: row.version,
    orderId: row.order_id,
    orderNumber: row.order_number,
    possibleClientId: row.possible_client_id,
    possibleClientName: row.possible_client_name,
  };
}

export async function getIncomingLeadSnapshot(member: AuthenticatedMember, filter: IncomingLeadListFilter): Promise<IncomingLeadSnapshot> {
  requirePermission(member, "leads.read");
  const sql = getDatabase();
  const queryPattern = `%${filter.query.replace(/[\\%_]/g, "\\$&")}%`;
  const [leadValues, countValues] = await Promise.all([
    sql`SELECT website_leads.id, website_leads.website_id, websites.name AS website_name, websites.domain AS website_domain,
        website_leads.external_event_id, website_leads.received_at, website_leads.contact_name, website_leads.phone,
        website_leads.email, website_leads.service_interest, website_leads.landing_url, website_leads.utm_source,
        website_leads.utm_campaign, website_leads.moderation_status, website_leads.review_note,
        organization_members.display_name AS reviewer_name, website_leads.reviewed_at, website_leads.version,
        orders.id AS order_id, orders.order_number,
        possible_client.id AS possible_client_id, possible_client.legal_name AS possible_client_name
      FROM website_leads
      JOIN websites ON websites.organization_id = website_leads.organization_id AND websites.id = website_leads.website_id
      LEFT JOIN organization_members ON organization_members.organization_id = website_leads.organization_id
        AND organization_members.id = website_leads.reviewed_by
      LEFT JOIN orders ON orders.organization_id = website_leads.organization_id AND orders.source_lead_id = website_leads.id
      LEFT JOIN LATERAL (
        SELECT clients.id, clients.legal_name
        FROM clients
        LEFT JOIN client_contacts ON client_contacts.organization_id = clients.organization_id AND client_contacts.client_id = clients.id
        WHERE clients.organization_id = website_leads.organization_id
          AND ((website_leads.email IS NOT NULL AND lower(clients.primary_email) = lower(website_leads.email))
            OR (website_leads.email IS NOT NULL AND lower(client_contacts.email) = lower(website_leads.email))
            OR (website_leads.phone IS NOT NULL
              AND right(regexp_replace(client_contacts.normalized_phone, '\\D', '', 'g'), 10)
                = right(regexp_replace(website_leads.phone, '\\D', '', 'g'), 10)))
        ORDER BY clients.created_at
        LIMIT 1
      ) possible_client ON true
      WHERE website_leads.organization_id = ${member.organizationId}
        AND (${filter.status} = 'all' OR website_leads.moderation_status = ${filter.status})
        AND (${filter.query} = '' OR concat_ws(' ', website_leads.contact_name, website_leads.phone, website_leads.email,
          website_leads.service_interest, websites.name, websites.domain, website_leads.utm_source) ILIKE ${queryPattern} ESCAPE '\\')
      ORDER BY CASE website_leads.moderation_status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        website_leads.received_at DESC
      LIMIT 250`,
    sql`SELECT moderation_status AS status, count(*)::integer AS count
      FROM website_leads WHERE organization_id = ${member.organizationId} GROUP BY moderation_status`,
  ]);
  const counts = { all: 0, new: 0, reviewing: 0, accepted: 0, rejected: 0 };
  for (const value of countValues) {
    const row = countRowSchema.parse(value);
    counts[row.status] = row.count;
    counts.all += row.count;
  }
  return { leads: leadValues.map(mapLead), counts };
}

export async function getIncomingLeadPrefill(member: AuthenticatedMember, leadId: string): Promise<IncomingLeadPrefill> {
  requirePermission(member, "leads.write");
  const parsedLeadId = z.string().uuid().parse(leadId);
  const [value] = await getDatabase()`SELECT website_leads.id, website_leads.version, website_leads.contact_name,
      website_leads.phone, website_leads.email, website_leads.service_interest, websites.name AS website_name,
      website_leads.landing_url, website_leads.utm_source, website_leads.utm_campaign,
      possible_client.id AS possible_client_id
    FROM website_leads JOIN websites ON websites.organization_id = website_leads.organization_id AND websites.id = website_leads.website_id
    LEFT JOIN LATERAL (
      SELECT clients.id FROM clients
      LEFT JOIN client_contacts ON client_contacts.organization_id = clients.organization_id AND client_contacts.client_id = clients.id
      WHERE clients.organization_id = website_leads.organization_id
        AND ((website_leads.email IS NOT NULL AND lower(clients.primary_email) = lower(website_leads.email))
          OR (website_leads.email IS NOT NULL AND lower(client_contacts.email) = lower(website_leads.email))
          OR (website_leads.phone IS NOT NULL
            AND right(regexp_replace(client_contacts.normalized_phone, '\\D', '', 'g'), 10)
              = right(regexp_replace(website_leads.phone, '\\D', '', 'g'), 10)))
      ORDER BY clients.created_at LIMIT 1
    ) possible_client ON true
    WHERE website_leads.organization_id = ${member.organizationId} AND website_leads.id = ${parsedLeadId}
      AND website_leads.moderation_status IN ('new', 'reviewing')`;
  if (!value) throw new IncomingLeadNotFoundError();
  const row = leadPrefillRowSchema.parse(value);
  const sourceLines = [
    `Заявка с сайта ${row.website_name}.`,
    row.landing_url ? `Страница: ${row.landing_url}` : null,
    row.utm_source ? `Источник: ${row.utm_source}${row.utm_campaign ? ` / ${row.utm_campaign}` : ""}` : null,
  ].filter(Boolean);
  return {
    sourceLeadId: row.id,
    sourceLeadVersion: row.version,
    possibleClientId: row.possible_client_id,
    contactName: row.contact_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    serviceInterest: row.service_interest ?? "",
    orderNotes: sourceLines.join("\n"),
  };
}

export async function rejectIncomingLead(member: AuthenticatedMember, input: RejectIncomingLeadInput) {
  requirePermission(member, "leads.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [lead] = await transaction`UPDATE website_leads
      SET moderation_status = 'rejected', review_note = ${input.reason}, reviewed_by = ${member.memberId}, reviewed_at = now(),
        updated_at = now(), version = version + 1
      WHERE organization_id = ${member.organizationId} AND id = ${input.leadId} AND version = ${input.expectedVersion}
        AND moderation_status IN ('new', 'reviewing')
      RETURNING id, version`;
    if (!lead) throw new IncomingLeadConflictError();
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'website_lead.reject', 'website_lead', ${input.leadId},
        ${transaction.json({ reason: input.reason, version: lead.version })})`;
    return z.number().int().positive().parse(lead.version);
  });
}

function fingerprintLead(input: WebsiteLeadWebhookInput) {
  const normalized = {
    contactName: input.contactName?.toLocaleLowerCase("ru") ?? null,
    phone: input.phone ? normalizeContactPhone(input.phone) : null,
    email: input.email ?? null,
    serviceInterest: input.serviceInterest?.toLocaleLowerCase("ru") ?? null,
    landingUrl: input.landingUrl ?? null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function ingestWebsiteLead(input: WebsiteLeadWebhookInput) {
  const sql = getDatabase();
  const fingerprint = fingerprintLead(input);
  const [website] = await sql`SELECT organization_id FROM websites WHERE id = ${input.websiteId} AND status <> 'disabled'`;
  if (!website) throw new IncomingLeadNotFoundError();
  const organizationId = z.string().uuid().parse(website.organization_id);
  const [rateLimit] = await sql`INSERT INTO website_lead_rate_limits (organization_id, website_id, window_started_at, request_count)
    VALUES (${organizationId}, ${input.websiteId}, now(), 1)
    ON CONFLICT (organization_id, website_id) DO UPDATE SET
      request_count = CASE
        WHEN website_lead_rate_limits.window_started_at <= now() - interval '1 minute' THEN 1
        ELSE website_lead_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN website_lead_rate_limits.window_started_at <= now() - interval '1 minute' THEN now()
        ELSE website_lead_rate_limits.window_started_at
      END
    RETURNING request_count`;
  if (z.coerce.number().int().parse(rateLimit.request_count) > 120) throw new IncomingLeadRateLimitError();

  return sql.begin(async (transaction) => {
    const [availableWebsite] = await transaction`SELECT id FROM websites
      WHERE organization_id = ${organizationId} AND id = ${input.websiteId} AND status <> 'disabled' FOR SHARE`;
    if (!availableWebsite) throw new IncomingLeadNotFoundError();
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${input.websiteId}:${fingerprint}`}, 0))`;
    const [existingEvent] = await transaction`SELECT id FROM website_leads
      WHERE organization_id = ${organizationId} AND website_id = ${input.websiteId} AND external_event_id = ${input.eventId}`;
    if (existingEvent) return { leadId: z.string().uuid().parse(existingEvent.id), duplicate: true };
    const [recentDuplicate] = await transaction`SELECT id FROM website_leads
      WHERE organization_id = ${organizationId} AND website_id = ${input.websiteId}
        AND payload_fingerprint = ${fingerprint} AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1`;
    if (recentDuplicate) return { leadId: z.string().uuid().parse(recentDuplicate.id), duplicate: true };
    const [lead] = await transaction`INSERT INTO website_leads (
        organization_id, website_id, external_event_id, received_at, contact_name, phone, email, service_interest,
        landing_url, referrer_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, payload_fingerprint
      ) VALUES (
        ${organizationId}, ${input.websiteId}, ${input.eventId}, ${input.receivedAt ? new Date(input.receivedAt) : new Date()},
        ${input.contactName}, ${input.phone}, ${input.email}, ${input.serviceInterest}, ${input.landingUrl}, ${input.referrerUrl},
        ${input.utmSource}, ${input.utmMedium}, ${input.utmCampaign}, ${input.utmContent}, ${input.utmTerm}, ${fingerprint}
      ) ON CONFLICT (organization_id, website_id, external_event_id) DO NOTHING RETURNING id`;
    if (!lead) {
      const [concurrentEvent] = await transaction`SELECT id FROM website_leads
        WHERE organization_id = ${organizationId} AND website_id = ${input.websiteId} AND external_event_id = ${input.eventId}`;
      if (!concurrentEvent) throw new Error("Incoming lead conflict could not be resolved.");
      return { leadId: z.string().uuid().parse(concurrentEvent.id), duplicate: true };
    }
    const leadId = z.string().uuid().parse(lead.id);
    await transaction`INSERT INTO audit_events (organization_id, action, entity_type, entity_id, changes)
      VALUES (${organizationId}, 'website_lead.receive', 'website_lead', ${leadId},
        ${transaction.json({ websiteId: input.websiteId, externalEventId: input.eventId })})`;
    return { leadId, duplicate: false };
  });
}
