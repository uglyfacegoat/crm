import type { OrganizationRole } from "@/server/auth/types";

export type ChatChannel = {
  id: string;
  name: string;
  description: string | null;
  kind: "general" | "group";
  memberCount: number;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastAuthor: string | null;
};

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorId: string;
  authorName: string;
  authorRole: OrganizationRole;
  mine: boolean;
};

export type ChatMember = {
  id: string;
  displayName: string;
  email: string;
  role: OrganizationRole;
  channelRole: "owner" | "member";
  current: boolean;
};

export type ChatMemberOption = {
  id: string;
  displayName: string;
  email: string;
  role: OrganizationRole;
};

export type ChatWorkspaceData = {
  channels: ChatChannel[];
  activeChannel: ChatChannel | null;
  messages: ChatMessage[];
  members: ChatMember[];
  memberOptions: ChatMemberOption[];
};
