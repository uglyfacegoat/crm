import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import { SitesWorkspace } from "@/components/sites/sites-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getDatabase } from "@/server/database";
import { getPreviewWebsiteSnapshot } from "@/server/sites/preview";
import { getWebsiteSnapshot } from "@/server/sites/repository";

export const metadata: Metadata = { title: "Сайты" };

export default async function SitesPage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "sites.read");
  const authPreview = getAuthMode() === "preview";
  const centerOverview = !authPreview && (await getDatabase()`SELECT organization_kind FROM organizations WHERE id = ${member.organizationId}`)[0]?.organization_kind === "center";
  const snapshot = authPreview ? getPreviewWebsiteSnapshot() : await getWebsiteSnapshot(member);

  return <SitesWorkspace snapshot={snapshot} canWrite={hasPermission(member, "sites.write") && !centerOverview} currentOrganizationId={member.organizationId} preview={authPreview} />;
}
