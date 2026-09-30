import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { organizationRoles, type AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

export const destinationEmailSchema = z.email().trim().toLowerCase().max(254);
const uuidSchema = z.uuid();

export type MailDestination = {
  id: string;
  email: string;
  leadsEnabled: boolean;
  mailEnabled: boolean;
  verified: boolean;
  sourcePreferences: { sourceId: string; leadsEnabled: boolean; mailEnabled: boolean }[];
};

export type MailSource = { id: string; organizationId: string; organizationName: string;
  address: string; displayName: string; websiteId: string | null };

async function accessibleMailMemberships(member: AuthenticatedMember) {
  requirePermission(member, "leads.read");
  const sql = getDatabase();
  const memberships = [{ organizationId: member.organizationId, memberId: member.memberId }];
  const [current] = await sql`SELECT organization_kind FROM organizations WHERE id = ${member.organizationId}`;
  if (current?.organization_kind !== "center" || !hasPermission(member, "companies.switch")) return memberships;
  const grants = await sql`SELECT grants.target_organization_id, grants.target_member_id,
      target.role, overrides.allowed AS leads_read_override
    FROM auth_sessions sessions
    JOIN organization_access_grants grants ON grants.principal_organization_id = sessions.organization_id
      AND grants.principal_member_id = sessions.member_id
    JOIN organization_members target ON target.organization_id = grants.target_organization_id
      AND target.id = grants.target_member_id AND target.active
    LEFT JOIN member_permission_overrides overrides ON overrides.organization_id = target.organization_id
      AND overrides.member_id = target.id AND overrides.permission = 'leads.read'
    WHERE sessions.id = ${member.sessionId} AND sessions.revoked_at IS NULL AND sessions.expires_at > now()`;
  for (const grant of grants) {
    const role = z.enum(organizationRoles).parse(grant.role);
    const permissionOverrides: Record<string, boolean> = grant.leads_read_override === null ? {}
      : { "leads.read": z.boolean().parse(grant.leads_read_override) };
    if (hasPermission({ role, permissionOverrides }, "leads.read")) {
      memberships.push({ organizationId: uuidSchema.parse(grant.target_organization_id),
        memberId: uuidSchema.parse(grant.target_member_id) });
    }
  }
  return memberships;
}

export async function listMailSources(member: AuthenticatedMember, includeAccessible = false): Promise<MailSource[]> {
  requirePermission(member, "leads.read");
  const organizationIds = includeAccessible
    ? (await accessibleMailMemberships(member)).map((item) => item.organizationId) : [member.organizationId];
  const rows = await getDatabase()`SELECT source.id, source.organization_id, organizations.name AS organization_name,
    source.address, source.display_name, source.website_id FROM mail_sources source
    JOIN organizations ON organizations.id = source.organization_id
    WHERE source.organization_id = ANY(${organizationIds}::uuid[]) AND source.active
    ORDER BY organizations.name, source.display_name, source.address`;
  return rows.map((row) => ({ id: uuidSchema.parse(row.id), organizationId: uuidSchema.parse(row.organization_id),
    organizationName: z.string().parse(row.organization_name), address: z.string().parse(row.address),
    displayName: z.string().parse(row.display_name), websiteId: row.website_id === null ? null : uuidSchema.parse(row.website_id) }));
}

export async function listOwnMailDestinations(member: AuthenticatedMember): Promise<MailDestination[]> {
  requirePermission(member, "leads.read");
  const sql = getDatabase();
  const rows = await sql`SELECT id, email, leads_enabled, mail_enabled, verified_at
    FROM member_mail_destinations WHERE organization_id = ${member.organizationId}
      AND member_id = ${member.memberId} ORDER BY created_at, id`;
  const preferences = await sql`SELECT preference.destination_id, preference.source_id,
      preference.leads_enabled, preference.mail_enabled FROM member_mail_source_subscriptions preference
    JOIN member_mail_destinations destination ON destination.organization_id = preference.organization_id
      AND destination.id = preference.destination_id
    WHERE destination.organization_id = ${member.organizationId} AND destination.member_id = ${member.memberId}`;
  return rows.map((row) => ({ id: uuidSchema.parse(row.id), email: z.string().parse(row.email),
    leadsEnabled: z.boolean().parse(row.leads_enabled), mailEnabled: z.boolean().parse(row.mail_enabled),
    verified: row.verified_at !== null,
    sourcePreferences: preferences.filter((preference) => preference.destination_id === row.id).map((preference) => ({
      sourceId: uuidSchema.parse(preference.source_id), leadsEnabled: z.boolean().parse(preference.leads_enabled),
      mailEnabled: z.boolean().parse(preference.mail_enabled),
    })) }));
}

export async function addOwnMailDestination(member: AuthenticatedMember, emailInput: string) {
  requirePermission(member, "leads.read");
  const email = destinationEmailSchema.parse(emailInput);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const [count] = await transaction`SELECT count(*)::integer AS total FROM member_mail_destinations
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}`;
    if (Number(count.total) >= 5) throw new Error("MAIL_DESTINATION_LIMIT");
    const [row] = await transaction`INSERT INTO member_mail_destinations
      (organization_id, member_id, email, verification_hash, verification_expires_at)
      VALUES (${member.organizationId}, ${member.memberId}, ${email}, ${hash}, now() + interval '24 hours')
      ON CONFLICT (organization_id, member_id, email) DO NOTHING RETURNING id`;
    if (!row) throw new Error("MAIL_DESTINATION_EXISTS");
    await transaction`INSERT INTO mail_delivery_jobs
      (organization_id, destination_id, source_type, source_id, verification_token)
      VALUES (${member.organizationId}, ${row.id}, 'verify', ${row.id}, ${token})`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'mail.destination.add', 'member_mail_destination', ${row.id}, ${transaction.json({ email })})`;
  });
}

export async function updateOwnMailDestination(member: AuthenticatedMember, idInput: string,
  preferences: { sourceId: string; leadsEnabled: boolean; mailEnabled: boolean }[]) {
  requirePermission(member, "leads.read");
  const id = uuidSchema.parse(idInput);
  if (preferences.length > 100 || new Set(preferences.map((preference) => preference.sourceId)).size !== preferences.length) {
    throw new Error("MAIL_SOURCE_SELECTION_INVALID");
  }
  const selected = preferences.filter((preference) => preference.leadsEnabled || preference.mailEnabled)
    .map((preference) => ({ ...preference, sourceId: uuidSchema.parse(preference.sourceId) }));
  await getDatabase().begin(async (transaction) => {
    const rows = await transaction`UPDATE member_mail_destinations
      SET leads_enabled = ${selected.some((preference) => preference.leadsEnabled)},
        mail_enabled = ${selected.some((preference) => preference.mailEnabled)}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId} AND id = ${id}
      RETURNING id`;
    if (!rows.length) throw new Error("MAIL_DESTINATION_NOT_FOUND");
    if (selected.length) {
      const sources = await transaction`SELECT id FROM mail_sources WHERE organization_id = ${member.organizationId}
        AND active AND id IN ${transaction(selected.map((preference) => preference.sourceId))}`;
      if (sources.length !== selected.length) throw new Error("MAIL_SOURCE_SELECTION_INVALID");
    }
    await transaction`DELETE FROM member_mail_source_subscriptions
      WHERE organization_id = ${member.organizationId} AND destination_id = ${id}`;
    for (const preference of selected) {
      await transaction`INSERT INTO member_mail_source_subscriptions
        (organization_id, destination_id, source_id, leads_enabled, mail_enabled)
        VALUES (${member.organizationId}, ${id}, ${preference.sourceId},
          ${preference.leadsEnabled}, ${preference.mailEnabled})`;
    }
  });
}

export async function removeOwnMailDestination(member: AuthenticatedMember, idInput: string) {
  requirePermission(member, "leads.read");
  const id = uuidSchema.parse(idInput);
  const rows = await getDatabase()`DELETE FROM member_mail_destinations
    WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId} AND id = ${id}
    RETURNING id`;
  if (!rows.length) throw new Error("MAIL_DESTINATION_NOT_FOUND");
}

export async function verifyMailDestination(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const hash = createHash("sha256").update(token).digest("hex");
  const rows = await getDatabase()`UPDATE member_mail_destinations
    SET verified_at = now(), verification_hash = NULL, verification_expires_at = NULL, updated_at = now()
    WHERE verification_hash = ${hash} AND verification_expires_at > now() AND verified_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

export type MailMessage = { id: string; fromAddress: string; fromName: string | null; subject: string;
  bodyText: string; receivedAt: string; mailboxAddress: string; recipientAddress: string | null;
  sourceId: string | null };

export const mailPageQuerySchema = z.object({
  folder: z.enum(["inbox", "sent"]).default("inbox"),
  source: z.union([z.literal("all"), uuidSchema]).default("all"),
  q: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type MailPageQuery = z.infer<typeof mailPageQuerySchema>;
export type MailPage = { messages: MailMessage[]; sent: OutgoingMail[]; total: number;
  counts: { inbox: number; sent: number } };

const parseMailMessage = (row: Record<string, unknown>): MailMessage => ({
  id: uuidSchema.parse(row.id), fromAddress: z.string().parse(row.from_address),
  fromName: row.from_name === null ? null : z.string().parse(row.from_name),
  subject: z.string().parse(row.subject), bodyText: z.string().parse(row.body_text),
  receivedAt: z.coerce.date().parse(row.received_at).toISOString(),
  mailboxAddress: z.string().parse(row.mailbox_address),
  recipientAddress: row.recipient_address === null ? null : z.string().parse(row.recipient_address),
  sourceId: row.source_id === null ? null : uuidSchema.parse(row.source_id),
});

export async function listMailMessages(member: AuthenticatedMember): Promise<MailMessage[]> {
  requirePermission(member, "leads.read");
  const organizationIds = (await accessibleMailMemberships(member)).map((item) => item.organizationId);
  const rows = await getDatabase()`SELECT id, from_address, from_name, subject, body_text,
    received_at, mailbox_address, recipient_address, source_id FROM mail_messages
    WHERE organization_id = ANY(${organizationIds}::uuid[]) ORDER BY received_at DESC, id DESC LIMIT 500`;
  return rows.map(parseMailMessage);
}

export type OutgoingMail = { id: string; sourceId: string; fromAddress: string; toAddress: string;
  subject: string; bodyText: string; status: "pending" | "sending" | "sent" | "failed";
  createdAt: string; sentAt: string | null; errorCode: string | null };

const parseOutgoingMail = (row: Record<string, unknown>): OutgoingMail => ({
  id: uuidSchema.parse(row.id), sourceId: uuidSchema.parse(row.source_id),
  fromAddress: z.string().parse(row.from_address), toAddress: z.string().parse(row.to_address),
  subject: z.string().parse(row.subject), bodyText: z.string().parse(row.body_text),
  status: z.enum(["pending", "sending", "sent", "failed"]).parse(row.status),
  createdAt: z.coerce.date().parse(row.created_at).toISOString(),
  sentAt: row.sent_at ? z.coerce.date().parse(row.sent_at).toISOString() : null,
  errorCode: row.last_error_code === null ? null : z.string().parse(row.last_error_code),
});

export async function listOutgoingMail(member: AuthenticatedMember): Promise<OutgoingMail[]> {
  requirePermission(member, "leads.read");
  const organizationIds = (await accessibleMailMemberships(member)).map((item) => item.organizationId);
  const rows = await getDatabase()`SELECT id, source_id, from_address, to_address, subject,
    body_text, status, created_at, sent_at, last_error_code FROM mail_outbox
    WHERE organization_id = ANY(${organizationIds}::uuid[]) ORDER BY created_at DESC, id DESC LIMIT 500`;
  return rows.map(parseOutgoingMail);
}

export async function listMailPage(member: AuthenticatedMember, input: MailPageQuery): Promise<MailPage> {
  requirePermission(member, "leads.read");
  const { folder, source, q, page } = mailPageQuerySchema.parse(input);
  const organizationIds = (await accessibleMailMemberships(member)).map((item) => item.organizationId);
  const sourceId = source === "all" ? null : source;
  const offset = page * 30;
  const sql = getDatabase();
  const [inboxCount, sentCount] = await Promise.all([
    sql`SELECT count(*)::integer AS total FROM mail_messages
      WHERE organization_id = ANY(${organizationIds}::uuid[])
        AND (${sourceId}::uuid IS NULL OR source_id = ${sourceId}::uuid)`,
    sql`SELECT count(*)::integer AS total FROM mail_outbox
      WHERE organization_id = ANY(${organizationIds}::uuid[])
        AND (${sourceId}::uuid IS NULL OR source_id = ${sourceId}::uuid)`,
  ]);
  const counts = { inbox: Number(inboxCount[0].total), sent: Number(sentCount[0].total) };
  if (folder === "inbox") {
    const [count, rows] = await Promise.all([
      sql`SELECT count(*)::integer AS total FROM mail_messages
        WHERE organization_id = ANY(${organizationIds}::uuid[])
          AND (${sourceId}::uuid IS NULL OR source_id = ${sourceId}::uuid)
          AND (${q} = '' OR position(lower(${q}) in lower(concat_ws(' ', from_name, from_address,
            recipient_address, mailbox_address, subject, body_text))) > 0)`,
      sql`SELECT id, from_address, from_name, subject, body_text, received_at,
          mailbox_address, recipient_address, source_id FROM mail_messages
        WHERE organization_id = ANY(${organizationIds}::uuid[])
          AND (${sourceId}::uuid IS NULL OR source_id = ${sourceId}::uuid)
          AND (${q} = '' OR position(lower(${q}) in lower(concat_ws(' ', from_name, from_address,
            recipient_address, mailbox_address, subject, body_text))) > 0)
        ORDER BY received_at DESC, id DESC LIMIT 30 OFFSET ${offset}`,
    ]);
    return { messages: rows.map(parseMailMessage), sent: [], total: Number(count[0].total), counts };
  }
  const [count, rows] = await Promise.all([
    sql`SELECT count(*)::integer AS total FROM mail_outbox
      WHERE organization_id = ANY(${organizationIds}::uuid[])
        AND (${sourceId}::uuid IS NULL OR source_id = ${sourceId}::uuid)
        AND (${q} = '' OR position(lower(${q}) in lower(concat_ws(' ', from_address,
          to_address, subject, body_text))) > 0)`,
    sql`SELECT id, source_id, from_address, to_address, subject, body_text,
        status, created_at, sent_at, last_error_code FROM mail_outbox
      WHERE organization_id = ANY(${organizationIds}::uuid[])
        AND (${sourceId}::uuid IS NULL OR source_id = ${sourceId}::uuid)
        AND (${q} = '' OR position(lower(${q}) in lower(concat_ws(' ', from_address,
          to_address, subject, body_text))) > 0)
      ORDER BY created_at DESC, id DESC LIMIT 30 OFFSET ${offset}`,
  ]);
  return { messages: [], sent: rows.map(parseOutgoingMail), total: Number(count[0].total), counts };
}

export const composeMailSchema = z.object({
  sourceId: uuidSchema,
  toAddress: destinationEmailSchema,
  subject: z.string().trim().min(1).max(500),
  bodyText: z.string().trim().min(1).max(100_000),
  replyToMessageId: uuidSchema.optional(),
});

export async function queueOutgoingMail(member: AuthenticatedMember, input: z.infer<typeof composeMailSchema>) {
  requirePermission(member, "leads.read");
  const data = composeMailSchema.parse(input);
  const sql = getDatabase();
  const memberships = await accessibleMailMemberships(member);
  const [source] = await sql`SELECT id, address FROM mail_sources
    WHERE organization_id = ANY(${memberships.map((item) => item.organizationId)}::uuid[])
      AND id = ${data.sourceId} AND active`;
  if (!source) throw new Error("MAIL_SOURCE_NOT_FOUND");
  const [sourceOrganization] = await sql`SELECT organization_id FROM mail_sources WHERE id = ${data.sourceId}`;
  const membership = memberships.find((item) => item.organizationId === sourceOrganization.organization_id);
  if (!membership) throw new Error("MAIL_SOURCE_NOT_FOUND");
  if (data.replyToMessageId) {
    const [message] = await sql`SELECT id FROM mail_messages WHERE organization_id = ${membership.organizationId}
      AND id = ${data.replyToMessageId} AND source_id = ${data.sourceId}`;
    if (!message) throw new Error("MAIL_REPLY_NOT_FOUND");
  }
  const [row] = await sql`INSERT INTO mail_outbox (organization_id, source_id, sender_member_id,
    from_address, to_address, subject, body_text, reply_to_message_id)
    VALUES (${membership.organizationId}, ${data.sourceId}, ${membership.memberId}, ${source.address},
      ${data.toAddress}, ${data.subject}, ${data.bodyText}, ${data.replyToMessageId ?? null}) RETURNING id`;
  return uuidSchema.parse(row.id);
}
