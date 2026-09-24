"use client";

import { useState } from "react";
import { BackupSystemPanel } from "@/components/settings/backup-system-panel";
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { DocumentTemplatePanel } from "@/components/settings/document-template-panel";
import { MemberAdminPanel } from "@/components/settings/member-admin-panel";
import { OrganizationPanel } from "@/components/settings/organization-panel";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import type { BackupSystemSnapshot } from "@/server/backups/types";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import type { MemberMasterOption, OrganizationMemberListItem } from "@/server/members/types";
import type { OrganizationSummary } from "@/server/organizations/types";
import type { AppearanceTheme, DigitStyle, FontScale } from "@/lib/appearance";

const settingTabs = [
  { id: "members", label: "Пользователи" },
  { id: "organizations", label: "Компании" },
  { id: "appearance", label: "Представление" },
  { id: "templates", label: "Шаблоны документов" },
  { id: "system", label: "Резервные копии" },
] as const;

type SettingTab = (typeof settingTabs)[number]["id"];
const settingTabOptions = settingTabs.map(({ id, label }) => ({ value: id, label }));

type SettingsWorkspaceProps = {
  members: OrganizationMemberListItem[];
  masterOptions: MemberMasterOption[];
  templates: DocumentTemplateListItem[];
  backupSnapshot: BackupSystemSnapshot;
  currentMemberId: string;
  preview: boolean;
  organizations: OrganizationSummary[];
  theme: AppearanceTheme;
  fontScale: FontScale;
  digitStyle: DigitStyle;
};

export function SettingsWorkspace({ members, masterOptions, templates, backupSnapshot, currentMemberId, preview, organizations, theme, fontScale, digitStyle }: SettingsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<SettingTab>("members");

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <SegmentedTabs
        tabs={settingTabOptions}
        value={activeTab}
        onChange={setActiveTab}
        label="Настройки CRM"
        idPrefix="settings"
      />

      <section id="settings-panel" role="tabpanel" aria-labelledby={`settings-${activeTab}-tab`}>
        {activeTab === "members" ? <MemberAdminPanel members={members} masterOptions={masterOptions} currentMemberId={currentMemberId} preview={preview} /> : null}
        {activeTab === "organizations" ? <OrganizationPanel organizations={organizations} preview={preview} /> : null}
        {activeTab === "appearance" ? <AppearancePanel theme={theme} fontScale={fontScale} digitStyle={digitStyle} /> : null}
        {activeTab === "templates" ? <DocumentTemplatePanel templates={templates} preview={preview} /> : null}
        {activeTab === "system" ? <BackupSystemPanel snapshot={backupSnapshot} preview={preview} /> : null}
      </section>
    </div>
  );
}
