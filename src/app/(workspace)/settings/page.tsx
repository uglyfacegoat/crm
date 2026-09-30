import type { Metadata } from "next";
import { MEMBER_PAGE_SIZE } from "@/lib/member-directory";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { emailOtpEnabled, getAuthMode } from "@/server/auth/config";
import { emailOtpDeliveryReady } from "@/server/auth/email-otp-repository";
import { getOwnSecurityState } from "@/server/auth/security-settings";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getBackupSystemSnapshot, getPreviewBackupSystemSnapshot } from "@/server/backups/repository";
import type { BackupSystemSnapshot } from "@/server/backups/types";
import { listDocumentTemplates } from "@/server/document-templates/repository";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import { listMemberMasterOptions, searchOrganizationMembers } from "@/server/members/repository";
import type { MemberActivity } from "@/server/members/activity";
import type { MemberDirectoryPage, MemberActivityAccount, MemberMasterOption, OrganizationMemberListItem } from "@/server/members/types";
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
  const member = await requireSession();
  const canManageSettings = hasPermission(member, "settings.write") && member.role !== "master" && member.role !== "foreman";
  const preview = getAuthMode() === "preview";
  const [security, securityMailReady] = await Promise.all([
    preview ? Promise.resolve({ enabled: false, pending: false }) : getOwnSecurityState(member),
    preview || !emailOtpEnabled() ? Promise.resolve(false) : emailOtpDeliveryReady(),
  ]);
  let members: OrganizationMemberListItem[];
  let memberPage: MemberDirectoryPage = { items: [], total: 0, page: 1, pageSize: MEMBER_PAGE_SIZE };
  let activityMembers: MemberActivityAccount[] = [];
  let masterOptions: MemberMasterOption[];
  let templates: DocumentTemplateListItem[];
  let backupSnapshot: BackupSystemSnapshot;
  let organizations: OrganizationSummary[];
  let activity: MemberActivity[];
  if (!canManageSettings && !preview) {
    members = [];
    masterOptions = [];
    templates = [];
    backupSnapshot = getPreviewBackupSystemSnapshot();
    organizations = [];
    activity = [];
  } else if (preview) {
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
    organizations = [{ id: member.organizationId, name: "Центр CRM", kind: "center", current: true, clientCount: 0, orderCount: 0, activeOrderCount: 0, upcomingVisitCount: 0, openTaskCount: 0, receivedMinor: 0 }];
    activity = [];
  } else {
    [memberPage, masterOptions, templates, backupSnapshot, organizations] = await Promise.all([searchOrganizationMembers(member, { q: "", status: "active", page: 1 }), listMemberMasterOptions(member), hasPermission(member, "document_templates.read") ? listDocumentTemplates(member) : Promise.resolve([]), getBackupSystemSnapshot(member), listOrganizationSummaries(member)]);
    members = memberPage.items;
    activity = [];
  }

  if (preview) { memberPage = { ...memberPage, items: members, total: members.length }; activityMembers = members; }

  return <div><PageHeading eyebrow="Конфигурация" title="Настройки" description="Личные уведомления, безопасность и параметры CRM." /><SettingsWorkspace memberPage={memberPage} activityMembers={activityMembers} activity={activity} masterOptions={masterOptions} templates={templates} backupSnapshot={backupSnapshot} currentMemberId={member.memberId} preview={preview} organizations={organizations} theme={theme} fontScale={fontScale} digitStyle={digitStyle} canManageSettings={canManageSettings} securityEmail={member.email} securityEnabled={security.enabled} securityPending={security.pending} securityMailReady={securityMailReady} canChatPush={hasPermission(member, "chat.read")} canEventPush={hasPermission(member, "notifications.read")} /></div>;
}
