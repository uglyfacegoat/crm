import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getBackupSystemSnapshot, getPreviewBackupSystemSnapshot } from "@/server/backups/repository";
import type { BackupSystemSnapshot } from "@/server/backups/types";
import { listRecentImportJobs } from "@/server/imports/repository";
import type { ImportJobListItem } from "@/server/imports/types";
import { listDocumentTemplates } from "@/server/document-templates/repository";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import { listMemberMasterOptions, listOrganizationMembers } from "@/server/members/repository";
import type { MemberMasterOption, OrganizationMemberListItem } from "@/server/members/types";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  const member = await requireOfficeSession();
  if (!hasPermission(member.role, "settings.write")) redirect("/");
  const preview = getAuthMode() === "preview";
  let members: OrganizationMemberListItem[];
  let masterOptions: MemberMasterOption[];
  let templates: DocumentTemplateListItem[];
  let backupSnapshot: BackupSystemSnapshot;
  let importJobs: ImportJobListItem[];
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
      }];
    masterOptions = [];
    templates = [];
    backupSnapshot = getPreviewBackupSystemSnapshot();
    importJobs = [];
  } else {
    [members, masterOptions, templates, backupSnapshot, importJobs] = await Promise.all([listOrganizationMembers(member), listMemberMasterOptions(member), listDocumentTemplates(member), getBackupSystemSnapshot(member), listRecentImportJobs(member)]);
  }

  return <div><PageHeading eyebrow="Конфигурация" title="Настройки" description="Управление системой, организацией, пользователями и будущими интеграциями." /><SettingsWorkspace members={members} masterOptions={masterOptions} templates={templates} backupSnapshot={backupSnapshot} importJobs={importJobs} currentMemberId={member.memberId} preview={preview} /></div>;
}
