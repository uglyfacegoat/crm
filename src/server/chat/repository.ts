import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { organizationRoles } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateChatChannelInput, SendChatMessageInput } from "./schemas";
import type { ChatChannel, ChatMember, ChatMemberOption, ChatMessage, ChatWorkspaceData } from "./types";

const uuidSchema = z.string().uuid();
const countSchema = z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]).transform(Number);
const channelRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["general", "group"]),
  member_count: countSchema,
  unread_count: countSchema,
  last_message: z.string().nullable(),
  last_message_at: z.coerce.date().nullable(),
  last_author: z.string().nullable(),
});
const messageRowSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  created_at: z.coerce.date(),
  edited_at: z.coerce.date().nullable(),
  author_id: uuidSchema,
  author_name: z.string(),
  author_role: z.enum(organizationRoles),
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
    memberCount: channel.member_count,
    unreadCount: channel.unread_count,
    lastMessage: channel.last_message,
    lastMessageAt: channel.last_message_at?.toISOString() ?? null,
    lastAuthor: channel.last_author,
  };
}

async function ensureGeneralChannel(member: AuthenticatedMember) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const inserted = await transaction`INSERT INTO chat_channels (organization_id, name, description, kind, created_by)
      VALUES (${member.organizationId}, 'Общий чат', 'Главный рабочий канал офиса', 'general', ${member.memberId})
      ON CONFLICT DO NOTHING RETURNING id`;
    const channelRows = inserted.length ? inserted : await transaction`SELECT id FROM chat_channels
      WHERE organization_id = ${member.organizationId} AND kind = 'general' AND archived_at IS NULL LIMIT 1`;
    const channelId = uuidSchema.parse(channelRows[0]?.id);
    await transaction`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
      SELECT members.organization_id, ${channelId}, members.id,
        CASE WHEN members.id = channels.created_by THEN 'owner' ELSE 'member' END, ${member.memberId}
      FROM organization_members members
      JOIN chat_channels channels ON channels.organization_id = members.organization_id AND channels.id = ${channelId}
      WHERE members.organization_id = ${member.organizationId} AND members.active AND members.role <> 'master'
      ON CONFLICT (organization_id, channel_id, member_id) DO NOTHING`;
    if (inserted.length) {
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.channel.provisioned', 'chat_channel', ${channelId})`;
    }
    return channelId;
  });
}

export async function getChatWorkspace(member: AuthenticatedMember, requestedChannelId: string | null): Promise<ChatWorkspaceData> {
  requirePermission(member, "chat.read");
  await ensureGeneralChannel(member);
  const sql = getDatabase();
  const channelRows = await sql`
    SELECT channels.id, channels.name, channels.description, channels.kind,
      (SELECT count(*) FROM chat_channel_members all_members WHERE all_members.organization_id = channels.organization_id AND all_members.channel_id = channels.id) AS member_count,
      (SELECT count(*) FROM chat_messages unread_messages
        WHERE unread_messages.organization_id = channels.organization_id AND unread_messages.channel_id = channels.id
          AND unread_messages.deleted_at IS NULL AND unread_messages.created_at > membership.last_read_at
          AND unread_messages.author_id <> ${member.memberId}) AS unread_count,
      latest.body AS last_message, latest.created_at AS last_message_at, latest.author_name AS last_author
    FROM chat_channel_members membership
    JOIN chat_channels channels ON channels.organization_id = membership.organization_id AND channels.id = membership.channel_id
    LEFT JOIN LATERAL (
      SELECT messages.body, messages.created_at, authors.display_name AS author_name
      FROM chat_messages messages
      JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
      WHERE messages.organization_id = channels.organization_id AND messages.channel_id = channels.id AND messages.deleted_at IS NULL
      ORDER BY messages.created_at DESC LIMIT 1
    ) latest ON true
    WHERE membership.organization_id = ${member.organizationId} AND membership.member_id = ${member.memberId} AND channels.archived_at IS NULL
    ORDER BY CASE channels.kind WHEN 'general' THEN 0 ELSE 1 END, coalesce(latest.created_at, channels.created_at) DESC
  `;
  const channels = channelRows.map(mapChannel);
  const activeChannel = channels.find((channel) => channel.id === requestedChannelId) ?? channels[0] ?? null;
  if (!activeChannel) return { channels, activeChannel: null, messages: [], members: [], memberOptions: [] };

  const canManage = member.role === "admin" || member.role === "dispatcher" || member.role === "manager";
  const [messageRows, channelMemberRows, memberOptionRows] = await Promise.all([
    sql`SELECT ordered_messages.id, ordered_messages.body, ordered_messages.created_at, ordered_messages.edited_at,
        ordered_messages.author_id, ordered_messages.author_name, ordered_messages.author_role
      FROM (
        SELECT messages.id, messages.body, messages.created_at, messages.edited_at, messages.author_id,
          authors.display_name AS author_name, authors.role AS author_role
        FROM chat_messages messages
        JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
        JOIN chat_channel_members access ON access.organization_id = messages.organization_id AND access.channel_id = messages.channel_id AND access.member_id = ${member.memberId}
        WHERE messages.organization_id = ${member.organizationId} AND messages.channel_id = ${activeChannel.id} AND messages.deleted_at IS NULL
        ORDER BY messages.created_at DESC LIMIT 150
      ) ordered_messages ORDER BY ordered_messages.created_at`,
    sql`SELECT members.id, members.display_name, members.email, members.role, membership.channel_role
      FROM chat_channel_members membership
      JOIN organization_members members ON members.organization_id = membership.organization_id AND members.id = membership.member_id
      WHERE membership.organization_id = ${member.organizationId} AND membership.channel_id = ${activeChannel.id} AND members.active
      ORDER BY CASE membership.channel_role WHEN 'owner' THEN 0 ELSE 1 END, members.display_name`,
    canManage
      ? sql`SELECT id, display_name, email, role FROM organization_members
          WHERE organization_id = ${member.organizationId} AND active AND role <> 'master' ORDER BY display_name`
      : Promise.resolve([]),
  ]);
  const messages: ChatMessage[] = messageRows.map((row) => { const message = messageRowSchema.parse(row); return { id: message.id, body: message.body, createdAt: message.created_at.toISOString(), editedAt: message.edited_at?.toISOString() ?? null, authorId: message.author_id, authorName: message.author_name, authorRole: message.author_role, mine: message.author_id === member.memberId }; });
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
        WHERE organization_id = ${member.organizationId} AND active AND role <> 'master' AND id = ANY(${selectedMemberIds}::uuid[])`;
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

export async function sendChatMessage(member: AuthenticatedMember, input: SendChatMessageInput) {
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
    await transaction`UPDATE chat_channels SET updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${input.channelId}`;
    await transaction`UPDATE chat_channel_members SET last_read_at = now()
      WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId} AND member_id = ${member.memberId}`;
    return input.idempotencyKey;
  });
}

export async function markChatChannelRead(member: AuthenticatedMember, channelId: string) {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  const updated = await sql`UPDATE chat_channel_members SET last_read_at = now()
    WHERE organization_id = ${member.organizationId} AND channel_id = ${channelId} AND member_id = ${member.memberId} RETURNING channel_id`;
  if (!updated.length) throw new ChatChannelNotFoundError();
}
