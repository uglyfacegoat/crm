import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeveloperMasterPwaPreview } from "@/components/visits/developer-master-pwa-preview";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getChatWorkspace } from "@/server/chat/repository";
import { listDocumentTemplates } from "@/server/document-templates/repository";
import { listVisits } from "@/server/visits/repository";

export const metadata: Metadata = { title: "Предпросмотр PWA мастера" };

export default async function DeveloperPwaPreviewPage() {
  const member = await requireSession();
  if (!hasPermission(member, "developer.preview")) redirect("/");

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - 30);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + 60);

  const [visits, templates, chat] = await Promise.all([
    listVisits(member, rangeStart.toISOString(), rangeEnd.toISOString()),
    listDocumentTemplates(member),
    getChatWorkspace(member, null),
  ]);

  return (
    <DeveloperMasterPwaPreview
      developerName={member.displayName}
      visits={visits.slice(0, 18)}
      templates={templates}
      chat={chat}
      now={now.toISOString()}
    />
  );
}
