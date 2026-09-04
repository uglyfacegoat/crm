import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MemberAccountWorkspace } from "@/components/settings/member-account-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listMemberMasterOptions, listOrganizationMembers } from "@/server/members/repository";
import type { OrganizationMemberListItem } from "@/server/members/types";

export const metadata: Metadata = { title: "Настройка пользователя" };

export default async function MemberSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const currentMember = await requireOfficeSession();
  if (!hasPermission(currentMember, "settings.write")) redirect("/");
  const { id } = await params;
  if (getAuthMode() === "preview") {
    if (id !== currentMember.memberId) notFound();
    const member: OrganizationMemberListItem = {
      id: currentMember.memberId,
      displayName: currentMember.displayName,
      email: currentMember.email,
      phone: null,
      role: currentMember.role,
      active: true,
      masterId: currentMember.masterId,
      masterName: null,
      lastLoginAt: null,
      version: 1,
      permissionOverrides: {},
    };
    return <MemberAccountWorkspace member={member} masterOptions={[]} currentMemberId={currentMember.memberId} />;
  }
  const [members, masterOptions] = await Promise.all([listOrganizationMembers(currentMember), listMemberMasterOptions(currentMember)]);
  const member = members.find((candidate) => candidate.id === id);
  if (!member) notFound();
  return <MemberAccountWorkspace member={member} masterOptions={masterOptions} currentMemberId={currentMember.memberId} />;
}
