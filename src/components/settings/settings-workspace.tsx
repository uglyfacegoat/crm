"use client";

import { useState } from "react";
import { BackupSystemPanel } from "@/components/settings/backup-system-panel";
import { DocumentTemplatePanel } from "@/components/settings/document-template-panel";
import { ImportPanel } from "@/components/settings/import-panel";
import { MemberAdminPanel } from "@/components/settings/member-admin-panel";
import { OrganizationPanel } from "@/components/settings/organization-panel";
import type { BackupSystemSnapshot } from "@/server/backups/types";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import type { ImportJobListItem } from "@/server/imports/types";
import type { MemberMasterOption, OrganizationMemberListItem } from "@/server/members/types";
import type { OrganizationOption } from "@/server/organizations/types";

const settingTabs = [
  { id: "members", label: "Пользователи" },
  { id: "organizations", label: "Компании" },
  { id: "templates", label: "Шаблоны документов" },
  { id: "import", label: "Импорт данных" },
  { id: "system", label: "Резервные копии" },
] as const;

type SettingTab = (typeof settingTabs)[number]["id"];

type SettingsWorkspaceProps = {
  members: OrganizationMemberListItem[];
  masterOptions: MemberMasterOption[];
  templates: DocumentTemplateListItem[];
  backupSnapshot: BackupSystemSnapshot;
  importJobs: ImportJobListItem[];
  currentMemberId: string;
  preview: boolean;
  organizations: OrganizationOption[];
};

export function SettingsWorkspace({ members, masterOptions, templates, backupSnapshot, importJobs, currentMemberId, preview, organizations }: SettingsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<SettingTab>("members");

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-px" role="tablist" aria-label="Настройки CRM">
        {settingTabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`settings-${tab.id}`} onClick={() => setActiveTab(tab.id)} className={`focus-ring h-11 shrink-0 border-b-2 px-3 text-xs transition-colors ${activeTab === tab.id ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[#788288] hover:text-white"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <section id={`settings-${activeTab}`} role="tabpanel">
        {activeTab === "members" ? <MemberAdminPanel members={members} masterOptions={masterOptions} currentMemberId={currentMemberId} preview={preview} /> : null}
        {activeTab === "organizations" ? <OrganizationPanel organizations={organizations} preview={preview} /> : null}
        {activeTab === "templates" ? <DocumentTemplatePanel templates={templates} preview={preview} /> : null}
        {activeTab === "import" ? <ImportPanel jobs={importJobs} preview={preview} /> : null}
        {activeTab === "system" ? <BackupSystemPanel snapshot={backupSnapshot} preview={preview} /> : null}
      </section>
    </div>
  );
}
