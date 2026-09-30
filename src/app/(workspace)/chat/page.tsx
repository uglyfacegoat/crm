import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requirePagePermission } from "@/server/auth/page-access";
import { requireSession } from "@/server/auth/session";
import { getPreviewChatWorkspace } from "@/server/chat/preview";
import { getChatWorkspace } from "@/server/chat/repository";

export const metadata: Metadata = { title: "Чат" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const member = await requireSession();
  requirePagePermission(member, "chat.read");
  const { channel = null } = await searchParams;
  const canRead = hasPermission(member, "chat.read");
  const canWrite = hasPermission(member, "chat.write");
  const canManage = hasPermission(member, "chat.manage");
  if (!canRead) return <div><PageHeading eyebrow="Коммуникации" title="Внутренний чат" description="Рабочие группы и история переписки." /><section className="surface-panel mt-7 p-8 text-sm text-[var(--muted)]">Для этой роли внутренний чат недоступен.</section></div>;
  const data = getAuthMode() === "preview" ? getPreviewChatWorkspace(member) : await getChatWorkspace(member, channel);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="chat-standalone-topbar">
      <Link href={member.role === "master" || member.role === "foreman" ? "/my-visits" : "/"} className="focus-ring chat-back-link" aria-label="Вернуться в CRM"><ArrowLeft className="size-4" /><span>В CRM</span></Link>
      <div className="chat-standalone-title"><MessageSquareText className="size-4" /><span>Чаты</span></div>
      <span className="chat-standalone-brand">CORE</span>
    </div>
    <ChatWorkspace data={data} canWrite={canWrite} canManage={canManage} composerRequestKey={randomUUID()} openConversationInitially={Boolean(channel)} />
  </div>;
}
