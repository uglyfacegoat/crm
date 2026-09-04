import type { Metadata } from "next";
import { z } from "zod";
import { DocumentsWorkspace } from "@/components/documents/documents-workspace";
import { UploadDocumentButton } from "@/components/documents/upload-document-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { emptyDocumentArchiveTree, parseDocumentArchiveSelection } from "@/server/documents/archive";
import { getDocumentArchiveTree, listDocuments, listDocumentUploadOptions } from "@/server/documents/repository";

export const metadata: Metadata = { title: "Документы" };

const documentIdSchema = z.string().uuid();

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requireOfficeSession();
  const resolvedSearchParams = await searchParams;
  const selection = parseDocumentArchiveSelection(resolvedSearchParams);
  const parsedDocumentId = documentIdSchema.safeParse(firstSearchValue(resolvedSearchParams.document));
  const initialDocumentId = parsedDocumentId.success ? parsedDocumentId.data : null;
  const preview = getAuthMode() === "preview";
  const canRead = hasPermission(member, "documents.read");
  const canWrite = hasPermission(member, "documents.write");
  const [documents, archive, uploadOptions] = preview || !canRead
    ? [[], emptyDocumentArchiveTree, { orders: [], visits: [] }]
    : await Promise.all([
      listDocuments(member, selection),
      getDocumentArchiveTree(member),
      canWrite ? listDocumentUploadOptions(member) : Promise.resolve({ orders: [], visits: [] }),
    ]);
  return (
    <div>
      <PageHeading
        eyebrow="Файловое хранилище"
        title="Документы"
        description="Документы связаны с клиентом, объектом, заказом и выездом."
        action={canWrite ? <UploadDocumentButton options={uploadOptions} /> : undefined}
      />
      {canRead ? <DocumentsWorkspace key={[selection.clientId, selection.objectId, selection.orderId, selection.category, initialDocumentId].join(":")} documents={documents} archive={archive} selection={selection} uploadOptions={uploadOptions} canWrite={canWrite && !preview} initialDocumentId={initialDocumentId} /> : <section className="surface-panel mt-7 p-8 text-sm text-[#8b959b]">Для этой роли архив документов пока недоступен.</section>}
    </div>
  );
}
