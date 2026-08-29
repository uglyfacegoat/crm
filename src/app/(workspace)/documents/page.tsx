import type { Metadata } from "next";
import { DocumentsWorkspace } from "@/components/documents/documents-workspace";
import { UploadDocumentButton } from "@/components/documents/upload-document-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { listDocuments, listDocumentUploadOptions } from "@/server/documents/repository";

export const metadata: Metadata = { title: "Документы" };

export default async function DocumentsPage() {
  const member = await requireSession();
  const preview = getAuthMode() === "preview";
  const canRead = hasPermission(member.role, "documents.read");
  const canWrite = hasPermission(member.role, "documents.write");
  const [documents, uploadOptions] = preview || !canRead
    ? [[], { orders: [], visits: [] }]
    : await Promise.all([listDocuments(member), canWrite ? listDocumentUploadOptions(member) : Promise.resolve({ orders: [], visits: [] })]);
  return (
    <div>
      <PageHeading
        eyebrow="Файловое хранилище"
        title="Документы"
        description="Документы связаны с клиентом, объектом, заказом и выездом."
        action={canWrite ? <UploadDocumentButton options={uploadOptions} /> : undefined}
      />
      {canRead ? <DocumentsWorkspace documents={documents} uploadOptions={uploadOptions} /> : <section className="surface-panel mt-7 p-8 text-sm text-[#8b959b]">Для этой роли архив документов пока недоступен.</section>}
    </div>
  );
}
