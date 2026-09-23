import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getBackupSystemSnapshot, getPreviewBackupSystemSnapshot } from "@/server/backups/repository";
import type { BackupSystemSnapshot } from "@/server/backups/types";
import { listDocumentTemplates } from "@/server/document-templates/repository";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import { listMemberMasterOptions, listOrganizationMembers } from "@/server/members/repository";
import type { MemberMasterOption, OrganizationMemberListItem } from "@/server/members/types";
import { listOrganizationSummaries } from "@/server/organizations/repository";
import type { OrganizationSummary } from "@/server/organizations/types";
import { cookies } from "next/headers";
import { APPEARANCE_THEME_COOKIE, DIGIT_STYLE_COOKIE, FONT_SCALE_COOKIE, parseAppearanceTheme, parseDigitStyle, parseFontScale } from "@/lib/appearance";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const fontScale = parseFontScale(cookieStore.get(FONT_SCALE_COOKIE)?.value);
  const digitStyle = parseDigitStyle(cookieStore.get(DIGIT_STYLE_COOKIE)?.value);
  const theme = parseAppearanceTheme(cookieStore.get(APPEARANCE_THEME_COOKIE)?.value);
  const member = await requireOfficeSession();
  if (!hasPermission(member, "settings.write")) redirect("/");
  const preview = getAuthMode() === "preview";
  let members: OrganizationMemberListItem[];
  let masterOptions: MemberMasterOption[];
  let templates: DocumentTemplateListItem[];
  let backupSnapshot: BackupSystemSnapshot;
  let organizations: OrganizationSummary[];
  if (preview) {
    members = [{
        id: member.memberId,
        displayName: member.displayName,
        email: member.email,
        phone: null,
        role: member.role,
        active: true,
        masterId: member.masterId,
        masterName: null,
        lastLoginAt: null,
        version: 1,
        permissionOverrides: {},
      }];
    masterOptions = [];
    templates = [];
    backupSnapshot = getPreviewBackupSystemSnapshot();
    organizations = [{ id: member.organizationId, name: "Центр компаний", kind: "center", current: true, clientCount: 0, orderCount: 0, activeOrderCount: 0, upcomingVisitCount: 0, openTaskCount: 0, receivedMinor: 0 }];
  } else {
    [members, masterOptions, templates, backupSnapshot, organizations] = await Promise.all([listOrganizationMembers(member), listMemberMasterOptions(member), listDocumentTemplates(member), getBackupSystemSnapshot(member), listOrganizationSummaries(member)]);
  }

  return <div><PageHeading eyebrow="Конфигурация" title="Настройки" description="Управление системой, компаниями, пользователями и защищёнными данными." /><SettingsWorkspace members={members} masterOptions={masterOptions} templates={templates} backupSnapshot={backupSnapshot} currentMemberId={member.memberId} preview={preview} organizations={organizations} theme={theme} fontScale={fontScale} digitStyle={digitStyle} /></div>;
}
