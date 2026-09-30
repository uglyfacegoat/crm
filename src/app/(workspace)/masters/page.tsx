import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import { CreateMasterButton } from "@/components/masters/master-dialog";
import { MastersWorkspace } from "@/components/masters/masters-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewMasters } from "@/server/masters/preview";
import { masterListQuerySchema } from "@/lib/master-list";
import { listMasterPage } from "@/server/masters/repository";

export const metadata: Metadata = { title: "Мастера" };

export default async function MastersPage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "masters.read");
  const preview = getAuthMode() === "preview";
  const initialPage = preview ? null : await listMasterPage(member, masterListQuerySchema.parse({}));
  const masters = initialPage?.items ?? getPreviewMasters();
  const canWrite = hasPermission(member, "masters.write");
  return <div><PageHeading eyebrow="Исполнители" title="Мастера" description="Зоны работы, контакты и текущая загрузка специалистов." action={canWrite ? <CreateMasterButton /> : undefined} /><MastersWorkspace key={`${member.organizationId}:${member.memberId}`} masters={masters} initialPage={initialPage} /></div>;
}
