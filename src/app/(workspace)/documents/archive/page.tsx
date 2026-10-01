import { documentListQuerySchema } from "@/lib/document-list";
import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import { DocumentArchiveManager } from "@/components/documents/document-archive-manager";
import { BackLink } from "@/components/ui/back-link";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import {
  listDocumentFolders,
  listDocumentPage,
} from "@/server/documents/repository";

export const metadata: Metadata = { title: "Управление архивом" };

export default async function DocumentArchivePage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "documents.read");
  const canRead = hasPermission(member, "documents.read");
  const canWrite =
    hasPermission(member, "documents.write") && getAuthMode() !== "preview";
  const initialQuery = documentListQuerySchema.parse({ scope: "own", rootOnly: true });
  const [folders, initialPage] =
    canRead && getAuthMode() !== "preview"
      ? await Promise.all([listDocumentFolders(member), listDocumentPage(member, initialQuery)])
      : [[], { items: [], total: 0, scopeTotal: 0, page: 1, pageSize: 50 }];

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
          key={`${member.memberId}:${member.organizationId}`}
          initialPage={initialPage}
          initialQuery={initialQuery}
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
