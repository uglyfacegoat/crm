"use client";

import { useSearchParams } from "next/navigation";
import { PushSettingsPanel } from "@/components/chat/chat-push-button";
import { BackupSystemPanel } from "@/components/settings/backup-system-panel";
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { DocumentTemplatePanel } from "@/components/settings/document-template-panel";
import { MemberAdminPanel } from "@/components/settings/member-admin-panel";
import { MemberActivityPanel } from "@/components/settings/member-activity-panel";
import { OrganizationPanel } from "@/components/settings/organization-panel";
import { SecurityWorkspace } from "@/components/settings/security-workspace";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import type { BackupSystemSnapshot } from "@/server/backups/types";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import type { MemberDirectoryPage, MemberActivityAccount, MemberMasterOption } from "@/server/members/types";
import type { MemberActivity } from "@/server/members/activity";
import type { OrganizationSummary } from "@/server/organizations/types";
import type { AppearanceTheme, DigitStyle, FontScale } from "@/lib/appearance";

const systemTabs = [
  { id: "members", label: "Пользователи" },
  { id: "activity", label: "Активность" },
  { id: "organizations", label: "Компании" },
  { id: "appearance", label: "Представление" },
  { id: "templates", label: "Шаблоны документов" },
  { id: "system", label: "Резервные копии" },
] as const;

type SettingTab = (typeof systemTabs)[number]["id"] | "security" | "notifications";
const systemTabOptions: { value: SettingTab; label: string }[] = systemTabs.map(({ id, label }) => ({ value: id, label }));

type SettingsWorkspaceProps = {
  memberPage: MemberDirectoryPage;
  activityMembers: MemberActivityAccount[];
  activity: MemberActivity[];
  masterOptions: MemberMasterOption[];
  templates: DocumentTemplateListItem[];
  backupSnapshot: BackupSystemSnapshot;
  currentMemberId: string;
  preview: boolean;
  organizations: OrganizationSummary[];
  theme: AppearanceTheme;
  fontScale: FontScale;
  digitStyle: DigitStyle;
  canManageSettings: boolean;
  securityEmail: string;
  securityEnabled: boolean;
  securityPending: boolean;
  securityMailReady: boolean;
  canChatPush: boolean;
  canEventPush: boolean;
};

export function SettingsWorkspace({ memberPage, activityMembers, activity, masterOptions, templates, backupSnapshot, currentMemberId, preview, organizations, theme, fontScale, digitStyle, canManageSettings, securityEmail, securityEnabled, securityPending, securityMailReady, canChatPush, canEventPush }: SettingsWorkspaceProps) {
  const searchParams = useSearchParams();
  const tabs = canManageSettings ? [{ value: "notifications" as const, label: "Уведомления" }, { value: "security" as const, label: "Безопасность" }, ...systemTabOptions] : [{ value: "notifications" as const, label: "Уведомления" }, { value: "security" as const, label: "Безопасность" }];
  const activeTab = tabs.find(({ value }) => value === searchParams.get("tab"))?.value ?? "notifications";

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <SegmentedTabs
        tabs={tabs}
        value={activeTab}
        onChange={(tab) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", tab);
          window.history.replaceState(null, "", `/settings?${params.toString()}`);
        }}
        label="Настройки CRM"
        idPrefix="settings"
      />

      <section id="settings-panel" role="tabpanel" aria-labelledby={`settings-${activeTab}-tab`}>
        {canManageSettings && activeTab === "members" ? <MemberAdminPanel initialPage={memberPage} masterOptions={masterOptions} currentMemberId={currentMemberId} preview={preview} /> : null}
        {canManageSettings && activeTab === "activity" ? <MemberActivityPanel members={activityMembers} activity={activity} /> : null}
        {canManageSettings && activeTab === "organizations" ? <OrganizationPanel organizations={organizations} preview={preview} /> : null}
        {canManageSettings && activeTab === "appearance" ? <AppearancePanel theme={theme} fontScale={fontScale} digitStyle={digitStyle} /> : null}
        {canManageSettings && activeTab === "templates" ? <DocumentTemplatePanel templates={templates} preview={preview} /> : null}
        {canManageSettings && activeTab === "system" ? <BackupSystemPanel snapshot={backupSnapshot} preview={preview} /> : null}
        {activeTab === "notifications" ? <div className="mt-6"><PushSettingsPanel preview={preview} canChat={canChatPush} canEvents={canEventPush} /></div> : null}
        {activeTab === "security" ? <div className="mt-6"><SecurityWorkspace email={securityEmail} initialEnabled={securityEnabled} initialPending={securityPending} mailReady={securityMailReady} preview={preview} embedded /></div> : null}
      </section>
    </div>
  );
}
