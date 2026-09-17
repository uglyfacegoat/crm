import type { OrganizationRole } from "@/server/auth/types";

export type ChatChannel = {
  id: string;
  name: string;
  description: string | null;
  kind: "general" | "group";
  managed: boolean;
  memberCount: number;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastAuthor: string | null;
  version: number;
};

export type ChatAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  extension: "pdf" | "jpg" | "png" | "webp" | "docx" | "xlsx";
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
