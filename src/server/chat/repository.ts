import "server-only";
import { z } from "zod";
import { AuthorizationError, hasPermission, requirePermission, type Permission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { organizationRoles } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { isChatEmoji } from "@/lib/chat-emojis";
import type { CreateChatChannelInput, CreateDirectChatInput, SendChatMessageInput, ToggleChatReactionInput, UpdateChatChannelMembersInput, UpdateChatChannelSettingsInput } from "./schemas";
import { chatEntityTypes, type ChatAttachmentDownload, type ChatAttachmentUpload, type ChatChannel, type ChatChannelAvatarDownload, type ChatEntityType, type ChatMember, type ChatMemberOption, type ChatMessage, type ChatSharedEntity, type ChatWorkspaceData } from "./types";

const uuidSchema = z.string().uuid();
const countSchema = z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]).transform(Number);
const sharedEntitySchema = z.object({
  type: z.enum(chatEntityTypes),
  id: uuidSchema,
  typeLabel: z.string(),
  title: z.string(),
  subtitle: z.string(),
  statusLabel: z.string(),
  statusTone: z.enum(["neutral", "accent", "success", "warning", "danger"]),
  href: z.string().startsWith("/"),
  meta: z.array(z.string()).max(4),
});
const entitySourceRowSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  subtitle: z.string(),
  status: z.string(),
  href: z.string().startsWith("/"),
  meta: z.array(z.string()).max(4),
});
const channelRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["general", "group"]),
  audience_kind: z.enum(["office", "master_direct", "direct"]),
  managed: z.boolean(),
  member_count: countSchema,
  unread_count: countSchema,
  last_message: z.string().nullable(),
  last_message_at: z.coerce.date().nullable(),
  last_author: z.string().nullable(),
  version: z.number().int().positive(),
  muted: z.boolean(),
  pinned: z.boolean(),
  avatar_exists: z.boolean(),
  online: z.boolean(),
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
  attachment_extension: z.enum(["pdf", "jpg", "png", "webp", "docx", "xlsx", "webm", "m4a", "mp3", "wav"]).nullable(),
  attachment_size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number).nullable(),
  shared_entity_snapshot: sharedEntitySchema.nullable(),
  reactions: z.array(z.object({ emoji: z.string().refine(isChatEmoji), count: countSchema, mine: z.boolean() })),
});
const memberRowSchema = z.object({
  id: uuidSchema,
  display_name: z.string(),
  email: z.string(),
  role: z.enum(organizationRoles),
  channel_role: z.enum(["owner", "member"]),
  online: z.boolean(),
});
const memberOptionRowSchema = memberRowSchema.omit({ channel_role: true, online: true });

export class ChatChannelNotFoundError extends Error {
  constructor() { super("Chat channel was not found or is unavailable."); this.name = "ChatChannelNotFoundError"; }
}

export class ChatChannelConflictError extends Error {
  constructor() { super("A channel with this name already exists."); this.name = "ChatChannelConflictError"; }
}

export class ChatMemberReferenceError extends Error {
  constructor() { super("One or more selected members are unavailable."); this.name = "ChatMemberReferenceError"; }
}

export class ChatDirectConversationError extends Error {
  constructor(message = "A direct conversation cannot be created for this member.") { super(message); this.name = "ChatDirectConversationError"; }
}

export class ChatChannelVersionConflictError extends Error {
  constructor() { super("The channel was changed by another member."); this.name = "ChatChannelVersionConflictError"; }
}

export class ChatGeneralChannelMutationError extends Error {
  constructor() { super("The system channel membership is managed automatically."); this.name = "ChatGeneralChannelMutationError"; }
}

export class ChatEntityUnavailableError extends Error {
  constructor() { super("The shared entity was not found or is unavailable."); this.name = "ChatEntityUnavailableError"; }
}

const chatEntityPermissions: Record<ChatEntityType, Permission> = {
  order: "orders.read",
  client: "clients.read",
  object: "clients.read",
  visit: "visits.read",
  contract: "contracts.read",
  document: "documents.read",
  task: "tasks.read",
  master: "masters.read",
  website: "sites.read",
};

const chatEntityLabels: Record<ChatEntityType, string> = {
  order: "Заказ",
  client: "Клиент",
  object: "Объект",
  visit: "Выезд",
  contract: "Договор",
  document: "Документ",
  task: "Задача",
  master: "Мастер",
  website: "Сайт",
};

const statusLabels: Record<ChatEntityType, Record<string, [string, ChatSharedEntity["statusTone"]]>> = {
  order: { new: ["Новый", "accent"], approval: ["На согласовании", "warning"], scheduled: ["Запланирован", "accent"], in_progress: ["В работе", "warning"], completed: ["Выполнен", "success"], overdue: ["Просрочен", "danger"], cancelled: ["Отменён", "neutral"] },
  client: { client: ["Клиент", "neutral"] },
  object: { low: ["Низкий риск", "success"], medium: ["Средний риск", "warning"], high: ["Высокий риск", "danger"], none: ["Риск не указан", "neutral"] },
  visit: { planned: ["Запланирован", "accent"], confirmed: ["Подтверждён", "success"], in_progress: ["В работе", "warning"], completed: ["Выполнен", "success"], cancelled: ["Отменён", "neutral"] },
  contract: { draft: ["Черновик", "neutral"], active: ["Активен", "success"], suspended: ["Приостановлен", "warning"], completed: ["Завершён", "neutral"], cancelled: ["Отменён", "danger"] },
  document: { contract: ["Договор", "accent"], act: ["Акт", "success"], visit_card: ["Карточка выезда", "accent"], invoice: ["Счёт", "warning"], receipt: ["Чек", "success"], photo: ["Фото", "neutral"], other: ["Документ", "neutral"] },
  task: { open: ["Открыта", "warning"], completed: ["Выполнена", "success"], cancelled: ["Отменена", "neutral"] },
  master: { active: ["Работает", "success"], inactive: ["Неактивен", "neutral"] },
  website: { setup: ["Настройка", "warning"], active: ["Активен", "success"], attention: ["Требует внимания", "danger"], disabled: ["Отключён", "neutral"] },
};

function canReadChatEntity(member: AuthenticatedMember, type: ChatEntityType) {
  return hasPermission(member, chatEntityPermissions[type]);
}

function mapSharedEntity(type: ChatEntityType, row: unknown): ChatSharedEntity {
  const source = entitySourceRowSchema.parse(row);
  const [statusLabel, statusTone] = statusLabels[type][source.status] ?? [source.status, "neutral" as const];
  return { type, id: source.id, typeLabel: chatEntityLabels[type], title: source.title, subtitle: source.subtitle, statusLabel, statusTone, href: source.href, meta: source.meta };
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
    audienceKind: channel.audience_kind,
    managed: channel.managed,
    memberCount: channel.member_count,
    unreadCount: channel.unread_count,
    lastMessage: channel.last_message,
    lastMessageAt: channel.last_message_at?.toISOString() ?? null,
    lastAuthor: channel.last_author,
    version: channel.version,
    muted: channel.muted,
    pinned: channel.pinned,
    avatarUrl: channel.avatar_exists ? `/api/v1/chat/channels/${channel.id}/avatar` : null,
    online: channel.online,
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

async function queryChatEntitySource(member: AuthenticatedMember, type: ChatEntityType, entityId: string | null = null, searchTerm = "") {
  if (!canReadChatEntity(member, type)) return [];
  const sql = getDatabase();
  const limit = entityId ? 1 : searchTerm ? 20 : 12;

  switch (type) {
    case "order":
      return sql`SELECT orders.id,
          'Заказ ' || orders.order_number AS title,
          clients.legal_name || ' · ' || objects.name AS subtitle,
          orders.status,
          '/orders/' || orders.id::text AS href,
          ARRAY[coalesce(masters.full_name, 'Без мастера'), objects.address]::text[] AS meta
        FROM orders
        JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
        JOIN client_objects objects ON objects.organization_id = orders.organization_id AND objects.id = orders.object_id
        LEFT JOIN masters ON masters.organization_id = orders.organization_id AND masters.id = orders.assigned_master_id
        WHERE orders.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR orders.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', orders.order_number, clients.legal_name, objects.name))) > 0)
        ORDER BY orders.updated_at DESC LIMIT ${limit}`;
    case "client":
      return sql`SELECT clients.id,
          clients.legal_name AS title,
          coalesce(clients.primary_email, 'Контактные данные не указаны') AS subtitle,
          'client' AS status,
          '/clients/' || clients.id::text AS href,
          ARRAY[coalesce(clients.primary_phone, 'Телефон не указан'),
            (SELECT count(*)::text || ' объектов' FROM client_objects WHERE organization_id = clients.organization_id AND client_id = clients.id)]::text[] AS meta
        FROM clients
        WHERE clients.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR clients.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', clients.legal_name, clients.primary_phone, clients.primary_email, clients.tax_id))) > 0)
        ORDER BY clients.updated_at DESC LIMIT ${limit}`;
    case "object":
      return sql`SELECT objects.id,
          objects.name AS title,
          clients.legal_name || ' · ' || objects.address AS subtitle,
          CASE WHEN objects.risk_level IS NULL THEN 'none' WHEN objects.risk_level <= 2 THEN 'low' WHEN objects.risk_level <= 4 THEN 'medium' ELSE 'high' END AS status,
          '/clients/' || objects.client_id::text AS href,
          ARRAY[objects.object_type, coalesce(objects.area_square_meters::text || ' м²', 'Площадь не указана')]::text[] AS meta
        FROM client_objects objects
        JOIN clients ON clients.organization_id = objects.organization_id AND clients.id = objects.client_id
        WHERE objects.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR objects.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', objects.name, objects.address, clients.legal_name))) > 0)
        ORDER BY objects.updated_at DESC LIMIT ${limit}`;
    case "visit":
      return sql`SELECT visits.id,
          'Выезд · ' || to_char(visits.scheduled_start_at AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') AS title,
          clients.legal_name || ' · ' || objects.name AS subtitle,
          visits.status,
          CASE WHEN visits.order_id IS NULL THEN '/calendar?visit=' || visits.id::text ELSE '/orders/' || visits.order_id::text END AS href,
          ARRAY[coalesce(orders.order_number, contracts.contract_number, 'Регламентный выезд'), objects.address]::text[] AS meta
        FROM service_visits visits
        JOIN client_objects objects ON objects.organization_id = visits.organization_id AND objects.id = visits.object_id
        JOIN clients ON clients.organization_id = objects.organization_id AND clients.id = objects.client_id
        LEFT JOIN orders ON orders.organization_id = visits.organization_id AND orders.id = visits.order_id
        LEFT JOIN contracts ON contracts.organization_id = visits.organization_id AND contracts.id = visits.contract_id
        WHERE visits.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR visits.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', orders.order_number, contracts.contract_number, clients.legal_name, objects.name))) > 0)
        ORDER BY visits.updated_at DESC LIMIT ${limit}`;
    case "contract":
      return sql`SELECT contracts.id,
          'Договор ' || contracts.contract_number AS title,
          clients.legal_name AS subtitle,
          contracts.status,
          '/contracts/' || contracts.id::text AS href,
          ARRAY[to_char(contracts.starts_on, 'DD.MM.YYYY') || ' — ' || to_char(contracts.ends_on, 'DD.MM.YYYY'), objects.name]::text[] AS meta
        FROM contracts
        JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
        JOIN client_objects objects ON objects.organization_id = contracts.organization_id AND objects.id = contracts.object_id
        WHERE contracts.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR contracts.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', contracts.contract_number, clients.legal_name, objects.name))) > 0)
        ORDER BY contracts.updated_at DESC LIMIT ${limit}`;
    case "document":
      return sql`SELECT documents.id,
          documents.title,
          clients.legal_name || ' · ' || orders.order_number AS subtitle,
          documents.category AS status,
          '/documents?document=' || documents.id::text AS href,
          ARRAY['Версия ' || coalesce(versions.version_number, 1)::text, objects.name]::text[] AS meta
        FROM documents
        JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
        JOIN client_objects objects ON objects.organization_id = documents.organization_id AND objects.id = documents.object_id
        JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
        LEFT JOIN document_versions versions ON versions.organization_id = documents.organization_id AND versions.id = documents.current_version_id
        WHERE documents.organization_id = ${member.organizationId} AND documents.archived_at IS NULL
          AND (${entityId}::uuid IS NULL OR documents.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', documents.title, clients.legal_name, orders.order_number))) > 0)
        ORDER BY documents.updated_at DESC LIMIT ${limit}`;
    case "task":
      return sql`SELECT tasks.id,
          tasks.title,
          coalesce(members.display_name, 'Без исполнителя') AS subtitle,
          tasks.status,
          '/tasks?task=' || tasks.id::text AS href,
          ARRAY['Приоритет: ' || tasks.priority,
            CASE WHEN tasks.due_at IS NULL THEN 'Без срока' ELSE 'Срок: ' || to_char(tasks.due_at AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') END]::text[] AS meta
        FROM tasks
        LEFT JOIN organization_members members ON members.organization_id = tasks.organization_id AND members.id = tasks.assigned_member_id
        WHERE tasks.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR tasks.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', tasks.title, members.display_name))) > 0)
        ORDER BY tasks.updated_at DESC LIMIT ${limit}`;
    case "master":
      return sql`SELECT masters.id,
          masters.full_name AS title,
          masters.service_region AS subtitle,
          CASE WHEN masters.active THEN 'active' ELSE 'inactive' END AS status,
          '/masters/' || masters.id::text AS href,
          ARRAY[masters.phone, coalesce(masters.messenger, 'Мессенджер не указан')]::text[] AS meta
        FROM masters
        WHERE masters.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR masters.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', masters.full_name, masters.phone, masters.service_region))) > 0)
        ORDER BY masters.updated_at DESC LIMIT ${limit}`;
    case "website":
      return sql`SELECT websites.id,
          websites.name AS title,
          websites.domain AS subtitle,
          websites.status,
          '/sites/' || websites.id::text AS href,
          ARRAY['Источник заявок', 'Обновлён ' || to_char(websites.updated_at AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY')]::text[] AS meta
        FROM websites
        WHERE websites.organization_id = ${member.organizationId}
          AND (${entityId}::uuid IS NULL OR websites.id = ${entityId}::uuid)
          AND (${searchTerm} = '' OR position(lower(${searchTerm}) in lower(concat_ws(' ', websites.name, websites.domain))) > 0)
        ORDER BY websites.updated_at DESC LIMIT ${limit}`;
  }
}

export async function searchChatEntityOptions(member: AuthenticatedMember, type: ChatEntityType, query: string) {
  requirePermission(member, "chat.read");
  if (!canReadChatEntity(member, type)) throw new AuthorizationError();
  const rows = await queryChatEntitySource(member, type, null, query);
  return rows.map((row) => mapSharedEntity(type, row));
}

async function listChatEntityOptions(member: AuthenticatedMember) {
  const allowedTypes = chatEntityTypes.filter((type) => canReadChatEntity(member, type));
  const rowsByType = await Promise.all(allowedTypes.map(async (type) => ({ type, rows: await queryChatEntitySource(member, type) })));
  return rowsByType.flatMap(({ type, rows }) => rows.map((row) => mapSharedEntity(type, row)));
}

async function resolveChatEntity(member: AuthenticatedMember, type: ChatEntityType, entityId: string) {
  if (!canReadChatEntity(member, type)) throw new ChatEntityUnavailableError();
  const rows = await queryChatEntitySource(member, type, entityId);
  if (!rows.length) throw new ChatEntityUnavailableError();
  return mapSharedEntity(type, rows[0]);
}

export async function getChatWorkspace(member: AuthenticatedMember, requestedChannelId: string | null): Promise<ChatWorkspaceData> {
  requirePermission(member, "chat.read");
  await ensureAccessibleChatChannels(member);
  const sql = getDatabase();
  const channelRows = await sql`
    SELECT channels.id,
      CASE WHEN channels.audience_kind = 'direct' THEN coalesce(direct_peer.display_name, channels.name) ELSE channels.name END AS name,
      CASE WHEN channels.audience_kind = 'direct' THEN 'Личная переписка' ELSE channels.description END AS description,
      channels.kind, channels.audience_kind, channels.version, membership.muted, membership.pinned,
      (avatars.channel_id IS NOT NULL) AS avatar_exists,
      coalesce(direct_peer.online, false) AS online,
      channels.audience_kind <> 'office' OR channels.kind = 'general' AS managed,
      (SELECT count(*) FROM chat_channel_members all_members WHERE all_members.organization_id = channels.organization_id AND all_members.channel_id = channels.id) AS member_count,
      (SELECT count(*) FROM chat_messages unread_messages
        WHERE unread_messages.organization_id = channels.organization_id AND unread_messages.channel_id = channels.id
          AND unread_messages.deleted_at IS NULL AND unread_messages.created_at > membership.last_read_at
          AND (unread_messages.author_id IS NULL OR unread_messages.author_id <> ${member.memberId})) AS unread_count,
      latest.body AS last_message, latest.created_at AS last_message_at, latest.author_name AS last_author
    FROM chat_channel_members membership
    JOIN chat_channels channels ON channels.organization_id = membership.organization_id AND channels.id = membership.channel_id
    LEFT JOIN chat_channel_avatars avatars ON avatars.organization_id = channels.organization_id AND avatars.channel_id = channels.id
    LEFT JOIN LATERAL (
      SELECT members.display_name,
        EXISTS (
          SELECT 1 FROM auth_sessions sessions
          WHERE sessions.revoked_at IS NULL AND sessions.expires_at > now()
            AND sessions.last_seen_at >= now() - interval '2 minutes'
            AND coalesce(sessions.active_organization_id, sessions.organization_id) = members.organization_id
            AND coalesce(sessions.active_member_id, sessions.member_id) = members.id
        ) AS online
      FROM chat_channel_members peer_membership
      JOIN organization_members members ON members.organization_id = peer_membership.organization_id AND members.id = peer_membership.member_id
      WHERE peer_membership.organization_id = channels.organization_id AND peer_membership.channel_id = channels.id
        AND peer_membership.member_id <> ${member.memberId}
      ORDER BY members.display_name
      LIMIT 1
    ) direct_peer ON channels.audience_kind = 'direct'
    LEFT JOIN LATERAL (
      SELECT messages.body, messages.created_at, coalesce(authors.display_name, 'Система') AS author_name
      FROM chat_messages messages
      LEFT JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
      WHERE messages.organization_id = channels.organization_id AND messages.channel_id = channels.id AND messages.deleted_at IS NULL
      ORDER BY messages.created_at DESC LIMIT 1
    ) latest ON true
    WHERE membership.organization_id = ${member.organizationId} AND membership.member_id = ${member.memberId} AND channels.archived_at IS NULL
    ORDER BY membership.pinned DESC, CASE channels.kind WHEN 'general' THEN 0 ELSE 1 END, coalesce(latest.created_at, channels.created_at) DESC
  `;
  const channels = channelRows.map(mapChannel);
  const activeChannel = channels.find((channel) => channel.id === requestedChannelId) ?? channels[0] ?? null;
  const entityOptionsPromise = listChatEntityOptions(member);
  if (!activeChannel) return { channels, activeChannel: null, messages: [], members: [], memberOptions: [], entityOptions: await entityOptionsPromise };

  const [messageRows, channelMemberRows, memberOptionRows, entityOptions] = await Promise.all([
    sql`SELECT ordered_messages.id, ordered_messages.body, ordered_messages.created_at, ordered_messages.edited_at,
        ordered_messages.author_id, ordered_messages.author_name, ordered_messages.author_role, ordered_messages.message_kind,
        ordered_messages.attachment_id, ordered_messages.attachment_filename, ordered_messages.attachment_mime_type,
        ordered_messages.attachment_extension, ordered_messages.attachment_size_bytes,
        ordered_messages.shared_entity_snapshot, ordered_messages.reactions
      FROM (
        SELECT messages.id, messages.body, messages.created_at, messages.edited_at, messages.author_id,
          authors.display_name AS author_name,
          CASE WHEN author_developers.email IS NOT NULL THEN 'developer' ELSE authors.role END AS author_role,
          messages.message_kind,
          attachments.id AS attachment_id, attachments.original_filename AS attachment_filename,
          attachments.mime_type AS attachment_mime_type, attachments.extension AS attachment_extension,
          attachments.size_bytes AS attachment_size_bytes,
          shared_entities.snapshot AS shared_entity_snapshot,
          coalesce(reaction_summary.reactions, '[]'::jsonb) AS reactions
        FROM chat_messages messages
        LEFT JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
        LEFT JOIN developer_accounts author_developers ON author_developers.email = authors.email
        LEFT JOIN chat_message_attachments attachments ON attachments.organization_id = messages.organization_id AND attachments.message_id = messages.id
        LEFT JOIN chat_message_entities shared_entities ON shared_entities.organization_id = messages.organization_id AND shared_entities.message_id = messages.id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('emoji', grouped.emoji, 'count', grouped.reaction_count, 'mine', grouped.mine) ORDER BY grouped.emoji) AS reactions
          FROM (
            SELECT reactions.emoji, count(*)::integer AS reaction_count,
              bool_or(reactions.member_id = ${member.memberId}) AS mine
            FROM chat_message_reactions reactions
            WHERE reactions.organization_id = messages.organization_id AND reactions.message_id = messages.id
            GROUP BY reactions.emoji
          ) grouped
        ) reaction_summary ON true
        JOIN chat_channel_members access ON access.organization_id = messages.organization_id AND access.channel_id = messages.channel_id AND access.member_id = ${member.memberId}
        WHERE messages.organization_id = ${member.organizationId} AND messages.channel_id = ${activeChannel.id} AND messages.deleted_at IS NULL
        ORDER BY messages.created_at DESC LIMIT 150
      ) ordered_messages ORDER BY ordered_messages.created_at`,
    sql`SELECT members.id, members.display_name, members.email,
        CASE WHEN developers.email IS NOT NULL THEN 'developer' ELSE members.role END AS role,
        membership.channel_role,
        EXISTS (
          SELECT 1 FROM auth_sessions sessions
          WHERE sessions.revoked_at IS NULL AND sessions.expires_at > now()
            AND sessions.last_seen_at >= now() - interval '2 minutes'
            AND coalesce(sessions.active_organization_id, sessions.organization_id) = members.organization_id
            AND coalesce(sessions.active_member_id, sessions.member_id) = members.id
        ) AS online
      FROM chat_channel_members membership
      JOIN organization_members members ON members.organization_id = membership.organization_id AND members.id = membership.member_id
      LEFT JOIN developer_accounts developers ON developers.email = members.email
      WHERE membership.organization_id = ${member.organizationId} AND membership.channel_id = ${activeChannel.id} AND members.active
      ORDER BY CASE membership.channel_role WHEN 'owner' THEN 0 ELSE 1 END, members.display_name`,
    sql`SELECT members.id, members.display_name, members.email,
          CASE WHEN developers.email IS NOT NULL THEN 'developer' ELSE members.role END AS role
          FROM organization_members members
          LEFT JOIN developer_accounts developers ON developers.email = lower(members.email)
          WHERE members.organization_id = ${member.organizationId} AND members.active
          ORDER BY members.display_name`,
    entityOptionsPromise,
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
    sharedEntity: message.shared_entity_snapshot && canReadChatEntity(member, message.shared_entity_snapshot.type) ? message.shared_entity_snapshot : null,
    mine: message.author_id === member.memberId,
    reactions: message.reactions,
  }; });
  const members: ChatMember[] = channelMemberRows.map((row) => { const channelMember = memberRowSchema.parse(row); return { id: channelMember.id, displayName: channelMember.display_name, email: channelMember.email, role: channelMember.role, channelRole: channelMember.channel_role, current: channelMember.id === member.memberId, online: channelMember.online }; });
  const memberOptions: ChatMemberOption[] = memberOptionRows.map((row) => { const option = memberOptionRowSchema.parse(row); return { id: option.id, displayName: option.display_name, email: option.email, role: option.role }; });
  return { channels, activeChannel, messages, members, memberOptions, entityOptions };
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

export async function createDirectChat(member: AuthenticatedMember, input: CreateDirectChatInput) {
  requirePermission(member, "chat.write");
  if (input.targetMemberId === member.memberId) throw new ChatDirectConversationError("You cannot start a direct conversation with yourself.");
  const [firstMemberId, secondMemberId] = [member.memberId, input.targetMemberId].sort();
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${'chat-direct:' + member.organizationId + ':' + firstMemberId + ':' + secondMemberId}, 0))`;
    const [existing] = await transaction`SELECT direct.channel_id, channels.archived_at
      FROM chat_direct_channels direct
      JOIN chat_channels channels ON channels.organization_id = direct.organization_id AND channels.id = direct.channel_id
      WHERE direct.organization_id = ${member.organizationId} AND direct.first_member_id = ${firstMemberId}
        AND direct.second_member_id = ${secondMemberId}`;
    if (existing) {
      const parsedExisting = z.object({ channel_id: uuidSchema, archived_at: z.coerce.date().nullable() }).parse(existing);
      if (parsedExisting.archived_at) await transaction`UPDATE chat_channels SET archived_at = NULL, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${parsedExisting.channel_id}`;
      return parsedExisting.channel_id;
    }

    const [target] = await transaction`SELECT id FROM organization_members
      WHERE organization_id = ${member.organizationId} AND id = ${input.targetMemberId} AND active`;
    if (!target) throw new ChatMemberReferenceError();

    const requestRows = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'chat.direct.create')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
    if (!requestRows.length) {
      const [request] = await transaction`SELECT operation, entity_id FROM idempotency_requests
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (request?.operation !== "chat.direct.create" || !request.entity_id) throw new Error("Idempotency key is already used by another operation.");
      return uuidSchema.parse(request.entity_id);
    }

    const internalName = `Личный чат ${firstMemberId.slice(0, 8)}-${secondMemberId.slice(0, 8)}`;
    const [channel] = await transaction`INSERT INTO chat_channels
      (organization_id, name, description, kind, created_by, audience_kind)
      VALUES (${member.organizationId}, ${internalName}, NULL, 'group', ${member.memberId}, 'direct')
      RETURNING id`;
    const channelId = uuidSchema.parse(channel.id);
    await transaction`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
      VALUES
        (${member.organizationId}, ${channelId}, ${member.memberId}, 'owner', ${member.memberId}),
        (${member.organizationId}, ${channelId}, ${input.targetMemberId}, 'member', ${member.memberId})`;
    await transaction`INSERT INTO chat_direct_channels (organization_id, channel_id, first_member_id, second_member_id)
      VALUES (${member.organizationId}, ${channelId}, ${firstMemberId}, ${secondMemberId})`;
    await transaction`UPDATE idempotency_requests SET entity_id = ${channelId}
      WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.direct.created', 'chat_channel', ${channelId},
        ${transaction.json({ firstMemberId, secondMemberId })})`;
    return channelId;
  });
}

export async function assertChatMessageAccess(member: AuthenticatedMember, channelId: string) {
  requirePermission(member, "chat.write");
  const sql = getDatabase();
  const rows = await sql`SELECT channels.id FROM chat_channels channels
    JOIN chat_channel_members membership ON membership.organization_id = channels.organization_id
      AND membership.channel_id = channels.id AND membership.member_id = ${member.memberId}
    WHERE channels.organization_id = ${member.organizationId} AND channels.id = ${channelId}
      AND channels.archived_at IS NULL`;
  if (!rows.length) throw new ChatChannelNotFoundError();
}

export async function assertChatAvatarAccess(member: AuthenticatedMember, channelId: string, expectedVersion: number) {
  requirePermission(member, "chat.read");
  requirePermission(member, "chat.manage");
  const sql = getDatabase();
  const [channel] = await sql`SELECT channels.kind, channels.audience_kind, channels.version FROM chat_channels channels
    JOIN chat_channel_members membership ON membership.organization_id = channels.organization_id
      AND membership.channel_id = channels.id AND membership.member_id = ${member.memberId}
    WHERE channels.organization_id = ${member.organizationId} AND channels.id = ${channelId}
      AND channels.archived_at IS NULL`;
  if (!channel) throw new ChatChannelNotFoundError();
  if (channel.kind !== "group" || channel.audience_kind !== "office") throw new ChatGeneralChannelMutationError();
  if (channel.version !== expectedVersion) throw new ChatChannelVersionConflictError();
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
  const sharedEntity = input.sharedEntityType && input.sharedEntityId
    ? await resolveChatEntity(member, input.sharedEntityType, input.sharedEntityId)
    : null;
  const messageBody = input.body || (sharedEntity ? `Поделился объектом: ${sharedEntity.typeLabel.toLowerCase()}` : "");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const accessRows = await transaction`SELECT membership.channel_id FROM chat_channel_members membership
      JOIN chat_channels channels ON channels.organization_id = membership.organization_id AND channels.id = membership.channel_id
      WHERE membership.organization_id = ${member.organizationId} AND membership.channel_id = ${input.channelId}
        AND membership.member_id = ${member.memberId} AND channels.archived_at IS NULL`;
    if (!accessRows.length) throw new ChatChannelNotFoundError();
    const inserted = await transaction`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body)
      VALUES (${input.idempotencyKey}, ${member.organizationId}, ${input.channelId}, ${member.memberId}, ${messageBody})
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
    if (sharedEntity) {
      await transaction`INSERT INTO chat_message_entities
        (organization_id, message_id, entity_type, entity_id, snapshot_schema_version, snapshot, created_by)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, ${sharedEntity.type}, ${sharedEntity.id}, 1,
          ${transaction.json(sharedEntity)}, ${member.memberId})`;
      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.entity.shared',
          ${sharedEntity.type}, ${sharedEntity.id},
          ${transaction.json({ messageId: input.idempotencyKey, channelId: input.channelId })})`;
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
    const parsedChannel = z.object({ kind: z.enum(["general", "group"]), audience_kind: z.enum(["office", "master_direct", "direct"]), version: z.number().int().positive() }).parse(channel);
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
  if (!uuidSchema.safeParse(attachmentId).success) throw new ChatChannelNotFoundError();
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
  return { id: attachment.id, filename: attachment.original_filename, mimeType: attachment.mime_type, sizeBytes: attachment.size_bytes, sha256: attachment.sha256, storageKey: attachment.storage_key };
}

export async function recordChatAttachmentDownload(member: AuthenticatedMember, attachmentId: string) {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.attachment.downloaded', 'chat_attachment', ${attachmentId})`;
}

export async function markChatChannelRead(member: AuthenticatedMember, channelId: string) {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  const updated = await sql`UPDATE chat_channel_members SET last_read_at = now()
    WHERE organization_id = ${member.organizationId} AND channel_id = ${channelId} AND member_id = ${member.memberId} RETURNING channel_id`;
  if (!updated.length) throw new ChatChannelNotFoundError();
}

export async function toggleChatChannelPin(member: AuthenticatedMember, channelId: string) {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [updated] = await transaction`UPDATE chat_channel_members SET pinned = NOT pinned
      WHERE organization_id = ${member.organizationId} AND channel_id = ${channelId} AND member_id = ${member.memberId}
      RETURNING pinned`;
    if (!updated) throw new ChatChannelNotFoundError();
    const pinned = z.object({ pinned: z.boolean() }).parse(updated).pinned;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.channel.pin_toggled', 'chat_channel', ${channelId},
        ${transaction.json({ pinned })})`;
    return pinned;
  });
}

export async function updateChatChannelSettings(
  member: AuthenticatedMember,
  input: UpdateChatChannelSettingsInput,
  avatar: (ChatAttachmentUpload & { extension: "jpg" | "png" | "webp" }) | null,
) {
  requirePermission(member, "chat.read");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [channel] = await transaction`SELECT channels.kind, channels.audience_kind, channels.version,
          membership.channel_role, avatars.storage_key AS avatar_storage_key, avatars.version AS avatar_version
        FROM chat_channels channels
        JOIN chat_channel_members membership ON membership.organization_id = channels.organization_id
          AND membership.channel_id = channels.id AND membership.member_id = ${member.memberId}
        LEFT JOIN chat_channel_avatars avatars ON avatars.organization_id = channels.organization_id AND avatars.channel_id = channels.id
        WHERE channels.organization_id = ${member.organizationId} AND channels.id = ${input.channelId}
          AND channels.archived_at IS NULL FOR UPDATE OF channels`;
      if (!channel) throw new ChatChannelNotFoundError();
      const parsed = z.object({
        kind: z.enum(["general", "group"]), audience_kind: z.enum(["office", "master_direct", "direct"]),
        version: z.number().int().positive(), channel_role: z.enum(["owner", "member"]),
        avatar_storage_key: z.string().nullable(), avatar_version: z.number().int().positive().nullable(),
      }).parse(channel);
      if (parsed.version !== input.expectedVersion) throw new ChatChannelVersionConflictError();
      const canEditDetails = hasPermission(member, "chat.manage") && parsed.kind === "group" && parsed.audience_kind === "office";
      if (canEditDetails) {
        const updated = await transaction`UPDATE chat_channels SET name = ${input.name}, description = ${input.description},
            version = version + 1, updated_at = now()
          WHERE organization_id = ${member.organizationId} AND id = ${input.channelId} AND version = ${input.expectedVersion}
          RETURNING version`;
        if (!updated.length) throw new ChatChannelVersionConflictError();
        if (avatar) {
          await transaction`INSERT INTO chat_channel_avatars
              (organization_id, channel_id, storage_key, mime_type, size_bytes, sha256, uploaded_by, version)
            VALUES (${member.organizationId}, ${input.channelId}, ${avatar.storageKey}, ${avatar.mimeType}, ${avatar.sizeBytes}, ${avatar.sha256}, ${member.memberId}, ${parsed.avatar_version ?? 1})
            ON CONFLICT (organization_id, channel_id) DO UPDATE SET storage_key = EXCLUDED.storage_key,
              mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256,
              uploaded_by = EXCLUDED.uploaded_by, version = chat_channel_avatars.version + 1, updated_at = now()`;
        }
      } else if (avatar) {
        throw new ChatGeneralChannelMutationError();
      }
      await transaction`UPDATE chat_channel_members SET muted = ${input.muted}
        WHERE organization_id = ${member.organizationId} AND channel_id = ${input.channelId} AND member_id = ${member.memberId}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'chat.channel.settings_updated', 'chat_channel', ${input.channelId},
          ${transaction.json({ name: canEditDetails ? input.name : undefined, muted: input.muted, avatarChanged: Boolean(avatar) })})`;
      return { previousAvatarStorageKey: parsed.avatar_storage_key };
    });
  } catch (error) {
    if (databaseConstraint(error) === "chat_channels_active_name_unique_idx") throw new ChatChannelConflictError();
    throw error;
  }
}

export async function toggleChatReaction(member: AuthenticatedMember, input: ToggleChatReactionInput) {
  requirePermission(member, "chat.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const rows = await transaction`SELECT messages.id FROM chat_messages messages
      JOIN chat_channel_members membership ON membership.organization_id = messages.organization_id
        AND membership.channel_id = messages.channel_id AND membership.member_id = ${member.memberId}
      WHERE messages.organization_id = ${member.organizationId} AND messages.id = ${input.messageId} AND messages.deleted_at IS NULL`;
    if (!rows.length) throw new ChatChannelNotFoundError();
    const deleted = await transaction`DELETE FROM chat_message_reactions
      WHERE organization_id = ${member.organizationId} AND message_id = ${input.messageId}
        AND member_id = ${member.memberId} AND emoji = ${input.emoji} RETURNING message_id`;
    if (!deleted.length) await transaction`INSERT INTO chat_message_reactions (organization_id, message_id, member_id, emoji)
      VALUES (${member.organizationId}, ${input.messageId}, ${member.memberId}, ${input.emoji})`;
  });
}

export async function getChatChannelAvatarDownload(member: AuthenticatedMember, channelId: string): Promise<ChatChannelAvatarDownload> {
  requirePermission(member, "chat.read");
  const rows = await getDatabase()`SELECT avatars.channel_id, avatars.mime_type, avatars.size_bytes, avatars.sha256, avatars.storage_key
    FROM chat_channel_avatars avatars
    JOIN chat_channel_members membership ON membership.organization_id = avatars.organization_id
      AND membership.channel_id = avatars.channel_id AND membership.member_id = ${member.memberId}
    WHERE avatars.organization_id = ${member.organizationId} AND avatars.channel_id = ${channelId}`;
  if (!rows.length) throw new ChatChannelNotFoundError();
  const avatar = z.object({ channel_id: uuidSchema, mime_type: z.string(), size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number), sha256: z.string().regex(/^[0-9a-f]{64}$/), storage_key: z.string() }).parse(rows[0]);
  return { channelId: avatar.channel_id, mimeType: avatar.mime_type, sizeBytes: avatar.size_bytes, sha256: avatar.sha256, storageKey: avatar.storage_key };
}
