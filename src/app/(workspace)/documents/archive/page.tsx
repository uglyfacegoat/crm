import type { Metadata } from "next";
import { DocumentArchiveManager } from "@/components/documents/document-archive-manager";
import { BackLink } from "@/components/ui/back-link";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import {
  listDocumentFolders,
  listDocuments,
} from "@/server/documents/repository";

export const metadata: Metadata = { title: "Управление архивом" };

export default async function DocumentArchivePage() {
  const member = await requireOfficeSession();
  const canRead = hasPermission(member, "documents.read");
  const canWrite =
    hasPermission(member, "documents.write") && getAuthMode() !== "preview";
  const [folders, documents] =
    canRead && getAuthMode() !== "preview"
      ? await Promise.all([listDocumentFolders(member), listDocuments(member)])
      : [[], []];

  return (
    <div>
      <BackLink href="/documents">К документам</BackLink>
      <div className="mt-5">
        <PageHeading
          eyebrow="Файловая структура"
          title="Управление архивом"
          description="Создавайте вложенные папки, собирайте выборку и переносите до 100 файлов и разделов одной операцией."
        />
      </div>
      {canRead ? (
        <DocumentArchiveManager
          folders={folders}
          documents={documents}
          canWrite={canWrite}
        />
      ) : (
        <section className="surface-panel mt-7 p-6 text-sm text-[var(--muted)]">
          Для этой роли архив документов недоступен.
        </section>
      )}
    </div>
  );
}
