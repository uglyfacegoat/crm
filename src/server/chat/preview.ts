import type { AuthenticatedMember } from "@/server/auth/types";
import type { ChatWorkspaceData } from "./types";

export function getPreviewChatWorkspace(member: AuthenticatedMember): ChatWorkspaceData {
  const channelId = "00000000-0000-4000-8000-000000000901";
  return {
    channels: [{ id: channelId, name: "Общий чат", description: "Главный рабочий канал офиса", kind: "general", managed: true, memberCount: 3, unreadCount: 0, lastMessage: "Рабочий режим подключит настоящую историю.", lastMessageAt: "2026-08-29T09:30:00.000Z", lastAuthor: "Система", version: 1 }],
    activeChannel: { id: channelId, name: "Общий чат", description: "Главный рабочий канал офиса", kind: "general", managed: true, memberCount: 3, unreadCount: 0, lastMessage: "Рабочий режим подключит настоящую историю.", lastMessageAt: "2026-08-29T09:30:00.000Z", lastAuthor: "Система", version: 1 },
    messages: [{ id: "00000000-0000-4000-8000-000000000902", body: "Это предварительный интерфейс. В рабочем режиме сообщения хранятся в PostgreSQL.", createdAt: "2026-08-29T09:30:00.000Z", editedAt: null, authorId: member.memberId, authorName: member.displayName, authorRole: member.role, kind: "user", attachment: null, mine: true }],
    members: [{ id: member.memberId, displayName: member.displayName, email: member.email, role: member.role, channelRole: "owner", current: true }],
    memberOptions: [],
  };
}
