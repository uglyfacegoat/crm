import type { AuthenticatedMember } from "@/server/auth/types";
import type { ChatWorkspaceData } from "./types";

export function getPreviewChatWorkspace(member: AuthenticatedMember): ChatWorkspaceData {
  const channelId = "00000000-0000-4000-8000-000000000901";
  return {
    channels: [{ id: channelId, name: "Общий чат", description: "Главный рабочий канал офиса", kind: "general", audienceKind: "office", managed: true, memberCount: 3, unreadCount: 0, lastMessage: "Рабочий режим подключит настоящую историю.", lastMessageAt: "2026-08-29T09:30:00.000Z", lastAuthor: "Система", version: 1, muted: false, pinned: false, avatarUrl: null, online: false }],
    activeChannel: { id: channelId, name: "Общий чат", description: "Главный рабочий канал офиса", kind: "general", audienceKind: "office", managed: true, memberCount: 3, unreadCount: 0, lastMessage: "Рабочий режим подключит настоящую историю.", lastMessageAt: "2026-08-29T09:30:00.000Z", lastAuthor: "Система", version: 1, muted: false, pinned: false, avatarUrl: null, online: false },
    messages: [{ id: "00000000-0000-4000-8000-000000000902", body: "Это предварительный интерфейс. В рабочем режиме сообщения хранятся в PostgreSQL.", createdAt: "2026-08-29T09:30:00.000Z", editedAt: null, authorId: member.memberId, authorName: member.displayName, authorRole: member.role, kind: "user", attachment: null, sharedEntity: null, mine: true, reactions: [] }],
    members: [{ id: member.memberId, displayName: member.displayName, email: member.email, role: member.role, channelRole: "owner", current: true, online: true }],
    memberOptions: [],
    entityOptions: [],
  };
}
