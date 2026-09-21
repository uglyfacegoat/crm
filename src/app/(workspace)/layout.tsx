import { AppShell } from "@/components/navigation/app-shell";
import { requireSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <AppShell currentUser={{ displayName: session.displayName, email: session.email, organizationName: session.organizationName, role: session.role, permissionOverrides: session.permissionOverrides }}>{children}</AppShell>;
}
