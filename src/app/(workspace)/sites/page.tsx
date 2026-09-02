import type { Metadata } from "next";
import { SitesWorkspace } from "@/components/sites/sites-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewWebsiteSnapshot } from "@/server/sites/preview";
import { getWebsiteSnapshot } from "@/server/sites/repository";

export const metadata: Metadata = { title: "Сайты" };

export default async function SitesPage() {
  const member = await requireOfficeSession();
  const preview = getAuthMode() === "preview";
  const snapshot = preview ? getPreviewWebsiteSnapshot() : await getWebsiteSnapshot(member);

  return <SitesWorkspace snapshot={snapshot} canWrite={hasPermission(member.role, "sites.write")} preview={preview} />;
}
