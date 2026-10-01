import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import Link from "next/link";
import { FolderCog } from "lucide-react";
import { notFound } from "next/navigation";
import { documentListQuerySchema } from "@/lib/document-list";
import { z } from "zod";
import { DocumentsWorkspace } from "@/components/documents/documents-workspace";
import { UploadDocumentButton } from "@/components/documents/upload-document-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import {
  emptyDocumentArchiveTree,
  parseDocumentArchiveSelection,
} from "@/server/documents/archive";
import {
  getDocumentArchiveTree,
  listDocumentFolders,
  listDocumentPage,
  getDocumentPanel,
  DocumentNotFoundError,
  listDocumentUploadOptions,
} from "@/server/documents/repository";

export const metadata: Metadata = { title: "Документы" };

const documentIdSchema = z.string().uuid();

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireOfficeSession();
  requirePagePermission(member, "documents.read");
  const resolvedSearchParams = await searchParams;
  const selection = parseDocumentArchiveSelection(resolvedSearchParams);
  const parsedDocumentId = documentIdSchema.safeParse(
    firstSearchValue(resolvedSearchParams.document),
  );
  const initialDocumentId = parsedDocumentId.success
    ? parsedDocumentId.data
    : null;
  const preview = getAuthMode() === "preview";
  const canRead = hasPermission(member, "documents.read");
  const canWrite = hasPermission(member, "documents.write");
  const initialQuery = documentListQuerySchema.parse({ ...selection, archiveCategory: selection.category, category: "all" });
  const [initialPage, archive, folders, uploadOptions] =
    preview || !canRead
      ? [
          { items: [], total: 0, scopeTotal: 0, page: 1, pageSize: 50 },
          emptyDocumentArchiveTree,
          [],
          { orders: [], visits: [], contracts: [] },
        ]
      : await Promise.all([
          listDocumentPage(member, initialQuery),
          getDocumentArchiveTree(member, true),
          listDocumentFolders(member, true),
          canWrite
            ? listDocumentUploadOptions(member)
            : Promise.resolve({ orders: [], visits: [], contracts: [] }),
        ]);
  const initialPanel = initialDocumentId && !preview ? await getDocumentPanel(member, initialDocumentId).catch(error => {
    if (error instanceof DocumentNotFoundError) notFound();
    throw error;
  }) : null;
  return (
    <div>
      <div className="surface-panel p-5 sm:p-6">
        <PageHeading
          eyebrow="Файловое хранилище"
          title="Документы"
          description="Документы связаны с клиентом, объектом, заказом и выездом."
          action={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/documents/archive"
                className="focus-ring flex h-11 items-center gap-2 rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
              >
                <FolderCog className="size-4" />
                Управление архивом
              </Link>
              {canWrite ? (
                <UploadDocumentButton options={uploadOptions} />
              ) : null}
            </div>
          }
        />
      </div>
      {canRead ? (
        <DocumentsWorkspace
          key={[
            member.memberId, member.organizationId,
            selection.clientId,
            selection.objectId,
            selection.orderId,
            selection.category,
            selection.folderId,
            selection.favoriteOnly,
            initialDocumentId,
          ].join(":")}
          initialPage={initialPage}
          initialQuery={initialQuery}
          initialPanel={initialPanel}
          organizationId={member.organizationId}
          archive={archive}
          folders={folders}
          selection={selection}
          uploadOptions={uploadOptions}
          canWrite={canWrite && !preview}
          initialDocumentId={initialDocumentId}
        />
      ) : (
        <section className="mt-7 border-y border-[var(--line)] px-2 py-8 text-sm text-[var(--muted)]">
          Для этой роли архив документов пока недоступен.
        </section>
      )}
    </div>
  );
}
