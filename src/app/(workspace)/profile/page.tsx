import type { Metadata } from "next";
import { ProfileWorkspace } from "@/components/settings/profile-workspace";
import { requireSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { listMailSources, listOwnMailDestinations } from "@/server/mail/repository";

export const metadata: Metadata = { title: "Мой профиль" };

export default async function ProfilePage() {
  const member = await requireSession();
  const [destinations, mailSources] = hasPermission(member, "leads.read") && getAuthMode() !== "preview"
    ? await Promise.all([listOwnMailDestinations(member), listMailSources(member)]) : [[], []];
  const mailReady = process.env.CRM_MAIL_ENABLED === "true";
  return <ProfileWorkspace displayName={member.displayName} email={member.email} role={member.role}
    destinations={destinations} mailSources={mailSources}
    canConfigureMail={hasPermission(member, "leads.read")} mailReady={mailReady} />;
}
