import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { MailWorkspace } from "@/components/mail/mail-workspace";
import { requireOfficeSession } from "@/server/auth/session";
import { requirePagePermission } from "@/server/auth/page-access";
import { getAuthMode } from "@/server/auth/config";
import { listMailPage, listMailSources } from "@/server/mail/repository";
import type { MailPage, MailSource } from "@/server/mail/repository";

export const metadata: Metadata = { title: "Почта" };

export default async function MailPage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "leads.read");
  const preview = getAuthMode() === "preview";
  const [initialPage, sources]: [MailPage, MailSource[]] = preview ? [
    { messages: [], sent: [], total: 0, counts: { inbox: 0, sent: 0 } }, [],
  ] : await Promise.all([
    listMailPage(member, { folder: "inbox", source: "all", q: "", page: 0 }),
    listMailSources(member, true),
  ]);
  const mailboxReady = process.env.CRM_MAIL_ENABLED === "true";
  const outboundReady = process.env.CRM_MAIL_OUTBOUND_ENABLED === "true";
  return <div className="flex h-full min-h-0 flex-col">
    <div className="mail-standalone-topbar"><Link href="/" className="focus-ring chat-back-link"><ArrowLeft className="size-4" />В CRM</Link>
      <div className="chat-standalone-title"><Mail className="size-4" />Почта</div><span className="chat-standalone-brand">CORE</span></div>
    <MailWorkspace initialPage={initialPage} sources={sources} mailboxReady={mailboxReady} outboundReady={outboundReady} />
  </div>;
}
