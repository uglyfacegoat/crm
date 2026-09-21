import type { OrganizationRole } from "@/server/auth/types";

export const chatEntityTypes = [
  "order",
  "client",
  "object",
  "visit",
  "contract",
  "document",
  "task",
  "master",
  "website",
] as const;

export type ChatEntityType = (typeof chatEntityTypes)[number];

export type ChatSharedEntity = {
  type: ChatEntityType;
  id: string;
  typeLabel: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: "neutral" | "accent" | "success" | "warning" | "danger";
  href: string;
  meta: string[];
};

export type ChatChannel = {
  id: string;
  name: string;
  description: string | null;
  kind: "general" | "group";
  audienceKind: "office" | "master_direct" | "direct";
  managed: boolean;
  memberCount: number;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastAuthor: string | null;
  version: number;
  muted: boolean;
  pinned: boolean;
  avatarUrl: string | null;
  online: boolean;
};

export type ChatAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  extension: "pdf" | "jpg" | "png" | "webp" | "docx" | "xlsx" | "webm" | "m4a" | "mp3" | "wav";
  sizeBytes: number;
};

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorId: string | null;
  authorName: string;
  authorRole: OrganizationRole | null;
  kind: "user" | "system";
  attachment: ChatAttachment | null;
  sharedEntity: ChatSharedEntity | null;
  mine: boolean;
  reactions: Array<{ emoji: ChatReactionEmoji; count: number; mine: boolean }>;
};

export type ChatMember = {
  id: string;
  displayName: string;
  email: string;
  role: OrganizationRole;
  channelRole: "owner" | "member";
  current: boolean;
  online: boolean;
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
  entityOptions: ChatSharedEntity[];
};

export type ChatAttachmentDownload = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export type ChatAttachmentUpload = {
  id: string;
  filename: string;
  mimeType: string;
  extension: ChatAttachment["extension"];
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export type ChatReactionEmoji = string;

export type ChatChannelAvatarDownload = {
  channelId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};
