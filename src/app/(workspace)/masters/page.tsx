import type { Metadata } from "next";
import { CreateMasterButton } from "@/components/masters/master-dialog";
import { MastersWorkspace } from "@/components/masters/masters-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewMasters } from "@/server/masters/preview";
import { listMasters } from "@/server/masters/repository";

export const metadata: Metadata = { title: "Мастера" };

export default async function MastersPage() {
  const member = await requireOfficeSession();
  const preview = getAuthMode() === "preview";
  const masters = preview ? getPreviewMasters() : await listMasters(member);
  const canWrite = hasPermission(member.role, "masters.write");
  return <div><PageHeading eyebrow="Исполнители" title="Мастера" description="Зоны работы, контакты и текущая загрузка специалистов." action={canWrite ? <CreateMasterButton /> : undefined} /><MastersWorkspace masters={masters} /></div>;
}
