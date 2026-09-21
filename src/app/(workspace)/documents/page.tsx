import type { Metadata } from "next";
import Link from "next/link";
import { FolderCog } from "lucide-react";
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
  listDocuments,
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
  const [documents, archive, folders, uploadOptions] =
    preview || !canRead
      ? [
          [],
          emptyDocumentArchiveTree,
          [],
          { orders: [], visits: [], contracts: [] },
        ]
      : await Promise.all([
          listDocuments(member, selection),
          getDocumentArchiveTree(member),
          listDocumentFolders(member),
          canWrite
            ? listDocumentUploadOptions(member)
            : Promise.resolve({ orders: [], visits: [], contracts: [] }),
        ]);
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
            selection.clientId,
            selection.objectId,
            selection.orderId,
            selection.category,
            selection.folderId,
            selection.favoriteOnly,
            initialDocumentId,
          ].join(":")}
          documents={documents}
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
