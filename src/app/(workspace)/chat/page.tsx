import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { CreateChatGroupButton } from "@/components/chat/create-chat-group-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewChatWorkspace } from "@/server/chat/preview";
import { getChatWorkspace } from "@/server/chat/repository";

export const metadata: Metadata = { title: "Чат" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const member = await requireOfficeSession();
  const { channel = null } = await searchParams;
  const canRead = hasPermission(member, "chat.read");
  const canWrite = hasPermission(member, "chat.write");
  const canManage = hasPermission(member, "chat.manage");
  if (!canRead) return <div><PageHeading eyebrow="Коммуникации" title="Внутренний чат" description="Рабочие группы и история переписки офиса." /><section className="surface-panel mt-7 p-8 text-sm text-[#8b959b]">Для этой роли внутренний чат пока недоступен.</section></div>;
  const data = getAuthMode() === "preview" ? getPreviewChatWorkspace(member) : await getChatWorkspace(member, channel);
  const currentMemberId = data.members.find((chatMember) => chatMember.current)?.id ?? member.memberId;
  return <div className="flex h-full min-h-0 flex-col"><PageHeading eyebrow="Коммуникации" title="Внутренний чат" description="Рабочие группы, сообщения и единая история общения офиса." action={canManage ? <CreateChatGroupButton memberOptions={data.memberOptions} currentMemberId={currentMemberId} /> : undefined} /><ChatWorkspace data={data} canWrite={canWrite} canManage={canManage} composerRequestKey={randomUUID()} /></div>;
}
