import { AppShell } from "@/components/navigation/app-shell";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { listAccessibleOrganizations } from "@/server/organizations/repository";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const organizations = getAuthMode() === "preview"
    ? [{ id: session.organizationId, name: "Центр компаний", kind: "center" as const, current: true }]
    : await listAccessibleOrganizations(session);
  return <AppShell currentUser={{ displayName: session.displayName, email: session.email, role: session.role, permissionOverrides: session.permissionOverrides }} organizations={organizations}>{children}</AppShell>;
}
