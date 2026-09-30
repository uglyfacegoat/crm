import { AppShell } from "@/components/navigation/app-shell";
import { requireSession } from "@/server/auth/session";
import { getAuthMode } from "@/server/auth/config";
import { getOwnProfileAvatarUrl } from "@/server/members/profile";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const avatarUrl = getAuthMode() === "preview" ? null : await getOwnProfileAvatarUrl(session);
  return <AppShell currentUser={{ displayName: session.displayName, email: session.email, organizationName: session.organizationName, role: session.role, permissionOverrides: session.permissionOverrides, avatarUrl }}>{children}</AppShell>;
}
