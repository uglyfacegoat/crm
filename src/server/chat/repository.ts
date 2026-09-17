import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { organizationRoles } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateChatChannelInput, SendChatMessageInput, UpdateChatChannelMembersInput } from "./schemas";
import type { ChatAttachmentDownload, ChatAttachmentUpload, ChatChannel, ChatMember, ChatMemberOption, ChatMessage, ChatWorkspaceData } from "./types";

const uuidSchema = z.string().uuid();
const countSchema = z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]).transform(Number);
const channelRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["general", "group"]),
  managed: z.boolean(),
  member_count: countSchema,
  unread_count: countSchema,
  last_message: z.string().nullable(),
  last_message_at: z.coerce.date().nullable(),
  last_author: z.string().nullable(),
  version: z.number().int().positive(),
});
const messageRowSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  created_at: z.coerce.date(),
  edited_at: z.coerce.date().nullable(),
  author_id: uuidSchema.nullable(),
  author_name: z.string().nullable(),
  author_role: z.enum(organizationRoles).nullable(),
  message_kind: z.enum(["user", "system"]),
  attachment_id: uuidSchema.nullable(),
  attachment_filename: z.string().nullable(),
  attachment_mime_type: z.string().nullable(),
  attachment_extension: z.enum(["pdf", "jpg", "png", "webp", "docx", "xlsx"]).nullable(),
  attachment_size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number).nullable(),
});
const memberRowSchema = z.object({
  id: uuidSchema,
  display_name: z.string(),
  email: z.string(),
  role: z.enum(organizationRoles),
  channel_role: z.enum(["owner", "member"]),
});
const memberOptionRowSchema = memberRowSchema.omit({ channel_role: true });

export class ChatChannelNotFoundError extends Error {
  constructor() { super("Chat channel was not found or is unavailable."); this.name = "ChatChannelNotFoundError"; }
}

export class ChatChannelConflictError extends Error {
  constructor() { super("A channel with this name already exists."); this.name = "ChatChannelConflictError"; }
}

export class ChatMemberReferenceError extends Error {
  constructor() { super("One or more selected members are unavailable."); this.name = "ChatMemberReferenceError"; }
}

export class ChatChannelVersionConflictError extends Error {
  constructor() { super("The channel was changed by another member."); this.name = "ChatChannelVersionConflictError"; }
}

export class ChatGeneralChannelMutationError extends Error {
  constructor() { super("The system channel membership is managed automatically."); this.name = "ChatGeneralChannelMutationError"; }
}

function databaseConstraint(error: unknown, code = "23505") {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== code) return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function mapChannel(row: unknown): ChatChannel {
  const channel = channelRowSchema.parse(row);
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    kind: channel.kind,
    managed: channel.managed,
    memberCount: channel.member_count,
    unreadCount: channel.unread_count,
    lastMessage: channel.last_message,
    lastMessageAt: channel.last_message_at?.toISOString() ?? null,
    lastAuthor: channel.last_author,
    version: channel.version,
  };
}

async function ensureGeneralChannel(member: AuthenticatedMember) {
  const sql = getDatabase();
  await sql`SELECT * FROM provision_chat_visit_reminders(
    ${member.organizationId}, ${member.memberId}, ${member.sessionId}
  )`;
  const channelRows = await sql`SELECT id FROM chat_channels
    WHERE organization_id = ${member.organizationId} AND kind = 'general' AND archived_at IS NULL LIMIT 1`;
  return uuidSchema.parse(channelRows[0]?.id);
}

async function ensureMasterDirectChannel(member: AuthenticatedMember) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${'master-direct-chat:' + member.organizationId + ':' + member.memberId}, 0))`;
    const existingRows = await transaction`SELECT id FROM chat_channels
      WHERE organization_id = ${member.organizationId} AND audience_kind = 'master_direct'
        AND subject_member_id = ${member.memberId} AND archived_at IS NULL
      LIMIT 1`;
    let channelId = existingRows.length ? uuidSchema.parse(existingRows[0].id) : null;
    const ownerRows = await transaction`SELECT id FROM organization_members
      WHERE organization_id = ${member.organizationId} AND active AND role <> 'master'
      ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'dispatcher' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, created_at
      LIMIT 1`;
    if (!ownerRows.length) throw new Error("A master chat requires an active office member.");
    const ownerMemberId = uuidSchema.parse(ownerRows[0].id);

    if (!channelId) {
      const suffix = member.memberId.replaceAll("-", "").slice(0, 4).toUpperCase();
      const [created] = await transaction`INSERT INTO chat_channels
        (organization_id, name, description, kind, created_by, audience_kind, subject_member_id)
        VALUES (${member.organizationId}, ${`Связь с мастером · ${member.displayName} · ${suffix}`},
          'Персональный рабочий канал мастера и офиса', 'group', ${ownerMemberId}, 'master_direct', ${member.memberId})
        RETURNING id`;
      channelId = uuidSchema.parse(created.id);
      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.master_channel.provisioned',
          'chat_channel', ${channelId}, ${transaction.json({ subjectMemberId: member.memberId })})`;
    }

    await transaction`DELETE FROM chat_channel_members membership
      USING organization_members members
      WHERE membership.organization_id = ${member.organizationId} AND membership.channel_id = ${channelId}
        AND members.organization_id = membership.organization_id AND members.id = membership.member_id
        AND (NOT members.active OR (members.role = 'master' AND members.id <> ${member.memberId}))`;
    await transaction`INSERT INTO chat_channel_members AS membership
      (organization_id, channel_id, member_id, channel_role, joined_by)
      SELECT members.organization_id, ${channelId}, members.id,
        CASE WHEN members.id = ${ownerMemberId} THEN 'owner' ELSE 'member' END, ${ownerMemberId}
      FROM organization_members members
      WHERE members.organization_id = ${member.organizationId} AND members.active
        AND (members.id = ${member.memberId} OR members.role <> 'master')
      ON CONFLICT (organization_id, channel_id, member_id) DO UPDATE
        SET channel_role = EXCLUDED.channel_role
        WHERE membership.channel_role IS DISTINCT FROM EXCLUDED.channel_role`;
    return channelId;
  });
}

async function ensureAccessibleChatChannels(member: AuthenticatedMember) {
  if (member.role === "master") return ensureMasterDirectChannel(member);
  return ensureGeneralChannel(member);
}

export async function getChatWorkspace(member: AuthenticatedMember, requestedChannelId: string | null): Promise<ChatWorkspaceData> {
  requirePermission(member, "chat.read");
  await ensureAccessibleChatChannels(member);
  const sql = getDatabase();
  const channelRows = await sql`
    SELECT channels.id, channels.name, channels.description, channels.kind, channels.version,
      channels.audience_kind <> 'office' OR channels.kind = 'general' AS managed,
      (SELECT count(*) FROM chat_channel_members all_members WHERE all_members.organization_id = channels.organization_id AND all_members.channel_id = channels.id) AS member_count,
      (SELECT count(*) FROM chat_messages unread_messages
        WHERE unread_messages.organization_id = channels.organization_id AND unread_messages.channel_id = channels.id
          AND unread_messages.deleted_at IS NULL AND unread_messages.created_at > membership.last_read_at
          AND (unread_messages.author_id IS NULL OR unread_messages.author_id <> ${member.memberId})) AS unread_count,
      latest.body AS last_message, latest.created_at AS last_message_at, latest.author_name AS last_author
    FROM chat_channel_members membership
    JOIN chat_channels channels ON channels.organization_id = membership.organization_id AND channels.id = membership.channel_id
    LEFT JOIN LATERAL (
      SELECT messages.body, messages.created_at, coalesce(authors.display_name, 'Система') AS author_name
      FROM chat_messages messages
      LEFT JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
      WHERE messages.organization_id = channels.organization_id AND messages.channel_id = channels.id AND messages.deleted_at IS NULL
      ORDER BY messages.created_at DESC LIMIT 1
    ) latest ON true
    WHERE membership.organization_id = ${member.organizationId} AND membership.member_id = ${member.memberId} AND channels.archived_at IS NULL
    ORDER BY CASE channels.kind WHEN 'general' THEN 0 ELSE 1 END, coalesce(latest.created_at, channels.created_at) DESC
  `;
  const channels = channelRows.map(mapChannel);
  const activeChannel = channels.find((channel) => channel.id === requestedChannelId) ?? channels[0] ?? null;
  if (!activeChannel) return { channels, activeChannel: null, messages: [], members: [], memberOptions: [] };

  const canManage = hasPermission(member, "chat.manage");
  const [messageRows, channelMemberRows, memberOptionRows] = await Promise.all([
    sql`SELECT ordered_messages.id, ordered_messages.body, ordered_messages.created_at, ordered_messages.edited_at,
        ordered_messages.author_id, ordered_messages.author_name, ordered_messages.author_role, ordered_messages.message_kind,
        ordered_messages.attachment_id, ordered_messages.attachment_filename, ordered_messages.attachment_mime_type,
        ordered_messages.attachment_extension, ordered_messages.attachment_size_bytes
      FROM (
        SELECT messages.id, messages.body, messages.created_at, messages.edited_at, messages.author_id,
          authors.display_name AS author_name,
          CASE WHEN author_developers.email IS NOT NULL THEN 'developer' ELSE authors.role END AS author_role,
          messages.message_kind,
          attachments.id AS attachment_id, attachments.original_filename AS attachment_filename,
          attachments.mime_type AS attachment_mime_type, attachments.extension AS attachment_extension,
          attachments.size_bytes AS attachment_size_bytes
        FROM chat_messages messages
        LEFT JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
        LEFT JOIN developer_accounts author_developers ON author_developers.email = authors.email
        LEFT JOIN chat_message_attachments attachments ON attachments.organization_id = messages.organization_id AND attachments.message_id = messages.id
        JOIN chat_channel_members access ON access.organization_id = messages.organization_id AND access.channel_id = messages.channel_id AND access.member_id = ${member.memberId}
        WHERE messages.organization_id = ${member.organizationId} AND messages.channel_id = ${activeChannel.id} AND messages.deleted_at IS NULL
        ORDER BY messages.created_at DESC LIMIT 150
      ) ordered_messages ORDER BY ordered_messages.created_at`,
    sql`SELECT members.id, members.display_name, members.email,
        CASE WHEN developers.email IS NOT NULL THEN 'developer' ELSE members.role END AS role,
        membership.channel_role
      FROM chat_channel_members membership
      JOIN organization_members members ON members.organization_id = membership.organization_id AND members.id = membership.member_id
      LEFT JOIN developer_accounts developers ON developers.email = members.email
      WHERE membership.organization_id = ${member.organizationId} AND membership.channel_id = ${activeChannel.id} AND members.active
      ORDER BY CASE membership.channel_role WHEN 'owner' THEN 0 ELSE 1 END, members.display_name`,
    canManage
      ? sql`SELECT members.id, members.display_name, members.email,
          CASE WHEN developers.email IS NOT NULL THEN 'developer' ELSE members.role END AS role
          FROM organization_members members
          LEFT JOIN developer_accounts developers ON developers.email = lower(members.email)
          WHERE members.organization_id = ${member.organizationId} AND members.active
          ORDER BY members.display_name`
      : Promise.resolve([]),
  ]);
  const messages: ChatMessage[] = messageRows.map((row) => { const message = messageRowSchema.parse(row); return {
    id: message.id,
    body: message.body,
    createdAt: message.created_at.toISOString(),
    editedAt: message.edited_at?.toISOString() ?? null,
    authorId: message.author_id,
    authorName: message.author_name ?? "Система",
    authorRole: message.author_role,
    kind: message.message_kind,
    attachment: message.attachment_id && message.attachment_filename && message.attachment_mime_type && message.attachment_extension && message.attachment_size_bytes !== null
      ? { id: message.attachment_id, filename: message.attachment_filename, mimeType: message.attachment_mime_type, extension: message.attachment_extension, sizeBytes: message.attachment_size_bytes }
      : null,
    mine: message.author_id === member.memberId,
  }; });
  const members: ChatMember[] = channelMemberRows.map((row) => { const channelMember = memberRowSchema.parse(row); return { id: channelMember.id, displayName: channelMember.display_name, email: channelMember.email, role: channelMember.role, channelRole: channelMember.channel_role, current: channelMember.id === member.memberId }; });
  const memberOptions: ChatMemberOption[] = memberOptionRows.map((row) => { const option = memberOptionRowSchema.parse(row); return { id: option.id, displayName: option.display_name, email: option.email, role: option.role }; });
  return { channels, activeChannel, messages, members, memberOptions };
}

export async function createChatChannel(member: AuthenticatedMember, input: CreateChatChannelInput) {
  requirePermission(member, "chat.manage");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const requestRows = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'chat.channel.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!requestRows.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "chat.channel.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return uuidSchema.parse(existing.entity_id);
      }

      const selectedMemberIds = [...new Set([...input.memberIds, member.memberId])];
      const validMembers = await transaction`SELECT id FROM organization_members
        WHERE organization_id = ${member.organizationId} AND active AND id = ANY(${selectedMemberIds}::uuid[])`;
      if (validMembers.length !== selectedMemberIds.length) throw new ChatMemberReferenceError();
      const [channel] = await transaction`INSERT INTO chat_channels (organization_id, name, description, kind, created_by)
        VALUES (${member.organizationId}, ${input.name}, ${input.description}, 'group', ${member.memberId}) RETURNING id`;
      const channelId = uuidSchema.parse(channel.id);
      for (const selectedMemberId of selectedMemberIds) {
        await transaction`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
          VALUES (${member.organizationId}, ${channelId}, ${selectedMemberId}, ${selectedMemberId === member.memberId ? "owner" : "member"}, ${member.memberId})`;
      }
      await transaction`UPDATE idempotency_requests SET entity_id = ${channelId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.channel.created', 'chat_channel', ${channelId},
          ${transaction.json({ name: input.name, memberIds: selectedMemberIds })})`;
      return channelId;
    });
  } catch (error) {
    if (databaseConstraint(error) === "chat_channels_active_name_unique_idx") throw new ChatChannelConflictError();
    throw error;
  }
}

export async function chatMessageExists(member: AuthenticatedMember, messageId: string, channelId: string) {
  requirePermission(member, "chat.write");
  const sql = getDatabase();
  const rows = await sql`SELECT messages.id FROM chat_messages messages
    JOIN chat_channel_members membership ON membership.organization_id = messages.organization_id
      AND membership.channel_id = messages.channel_id AND membership.member_id = ${member.memberId}
    WHERE messages.organization_id = ${member.organizationId} AND messages.id = ${messageId}
      AND messages.channel_id = ${channelId} AND messages.author_id = ${member.memberId}`;
  return rows.length > 0;
}

export async function sendChatMessage(member: AuthenticatedMember, input: SendChatMessageInput, attachment: ChatAttachmentUpload | null = null) {
  requirePermission(member, "chat.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const accessRows = await transaction`SELECT channel_id FROM chat_channel_members
      WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId} AND member_id = ${member.memberId}`;
    if (!accessRows.length) throw new ChatChannelNotFoundError();
    const inserted = await transaction`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body)
      VALUES (${input.idempotencyKey}, ${member.organizationId}, ${input.channelId}, ${member.memberId}, ${input.body})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (!inserted.length) {
      const existing = await transaction`SELECT id FROM chat_messages WHERE organization_id = ${member.organizationId}
        AND id = ${input.idempotencyKey} AND channel_id = ${input.channelId} AND author_id = ${member.memberId}`;
      if (!existing.length) throw new Error("Message idempotency key collision.");
      return input.idempotencyKey;
    }
    if (attachment) {
      await transaction`INSERT INTO chat_message_attachments
        (id, organization_id, message_id, original_filename, storage_key, mime_type, extension, size_bytes, sha256, uploaded_by)
        VALUES (${attachment.id}, ${member.organizationId}, ${input.idempotencyKey}, ${attachment.filename}, ${attachment.storageKey},
          ${attachment.mimeType}, ${attachment.extension}, ${attachment.sizeBytes}, ${attachment.sha256}, ${member.memberId})`;
    }
    await transaction`UPDATE chat_channels SET updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${input.channelId}`;
    await transaction`UPDATE chat_channel_members SET last_read_at = now()
      WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId} AND member_id = ${member.memberId}`;
    return input.idempotencyKey;
  });
}

export async function updateChatChannelMembers(member: AuthenticatedMember, input: UpdateChatChannelMembersInput) {
  requirePermission(member, "chat.manage");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [channel] = await transaction`SELECT kind, audience_kind, version FROM chat_channels
      WHERE organization_id = ${member.organizationId} AND id = ${input.channelId} AND archived_at IS NULL
      FOR UPDATE`;
    if (!channel) throw new ChatChannelNotFoundError();
    const parsedChannel = z.object({ kind: z.enum(["general", "group"]), audience_kind: z.enum(["office", "master_direct"]), version: z.number().int().positive() }).parse(channel);
    if (parsedChannel.kind === "general" || parsedChannel.audience_kind !== "office") throw new ChatGeneralChannelMutationError();
    if (parsedChannel.version !== input.expectedVersion) throw new ChatChannelVersionConflictError();

    const ownerRows = await transaction`SELECT member_id FROM chat_channel_members
      WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId} AND channel_role = 'owner'`;
    const ownerIds = ownerRows.map((row) => uuidSchema.parse(row.member_id));
    const selectedMemberIds = [...new Set([...input.memberIds, ...ownerIds])];
    const validMembers = selectedMemberIds.length
      ? await transaction`SELECT id FROM organization_members
          WHERE organization_id = ${member.organizationId} AND active AND id = ANY(${selectedMemberIds}::uuid[])`
      : [];
    if (validMembers.length !== selectedMemberIds.length) throw new ChatMemberReferenceError();

    const previousRows = await transaction`SELECT member_id FROM chat_channel_members
      WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId}`;
    const previousMemberIds = previousRows.map((row) => uuidSchema.parse(row.member_id));
    await transaction`DELETE FROM chat_channel_members
      WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId}
        AND channel_role = 'member' AND member_id <> ALL(${selectedMemberIds}::uuid[])`;
    for (const memberId of selectedMemberIds) {
      await transaction`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
        VALUES (${member.organizationId}, ${input.channelId}, ${memberId}, ${ownerIds.includes(memberId) ? "owner" : "member"}, ${member.memberId})
        ON CONFLICT (organization_id, channel_id, member_id) DO NOTHING`;
    }
    const [updated] = await transaction`UPDATE chat_channels SET version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.channelId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updated) throw new ChatChannelVersionConflictError();
    const version = z.object({ version: z.number().int().positive() }).parse(updated).version;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.channel.members_updated', 'chat_channel', ${input.channelId},
        ${transaction.json({ before: previousMemberIds, after: selectedMemberIds, version })})`;
    return version;
  });
}

export async function getChatAttachmentDownload(member: AuthenticatedMember, attachmentId: string): Promise<ChatAttachmentDownload> {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  const rows = await sql`SELECT attachments.id, attachments.original_filename, attachments.mime_type,
      attachments.size_bytes, attachments.sha256, attachments.storage_key
    FROM chat_message_attachments attachments
    JOIN chat_messages messages ON messages.organization_id = attachments.organization_id AND messages.id = attachments.message_id
    JOIN chat_channel_members membership ON membership.organization_id = messages.organization_id
      AND membership.channel_id = messages.channel_id AND membership.member_id = ${member.memberId}
    WHERE attachments.organization_id = ${member.organizationId} AND attachments.id = ${attachmentId}
      AND messages.deleted_at IS NULL`;
  if (!rows.length) throw new ChatChannelNotFoundError();
  const attachment = z.object({
    id: uuidSchema,
    original_filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    storage_key: z.string(),
  }).parse(rows[0]);
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.attachment.downloaded', 'chat_attachment', ${attachment.id})`;
  return { id: attachment.id, filename: attachment.original_filename, mimeType: attachment.mime_type, sizeBytes: attachment.size_bytes, sha256: attachment.sha256, storageKey: attachment.storage_key };
}

export async function markChatChannelRead(member: AuthenticatedMember, channelId: string) {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  const updated = await sql`UPDATE chat_channel_members SET last_read_at = now()
    WHERE organization_id = ${member.organizationId} AND channel_id = ${channelId} AND member_id = ${member.memberId} RETURNING channel_id`;
  if (!updated.length) throw new ChatChannelNotFoundError();
}
