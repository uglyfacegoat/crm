import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateDocumentMetadataInput } from "./schemas";
import { documentCategoryLabels, type DocumentDownload, type DocumentListItem, type DocumentUploadOptions } from "./types";

const uuidSchema = z.string().uuid();
const documentRowSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  category: z.enum(["contract", "act", "visit_card", "invoice", "receipt", "photo", "other"]),
  description: z.string().nullable(),
  client_id: uuidSchema,
  client_name: z.string(),
  object_id: uuidSchema,
  object_name: z.string(),
  object_address: z.string(),
  order_id: uuidSchema,
  order_number: z.string(),
  visit_id: uuidSchema.nullable(),
  visit_scheduled_start_at: z.coerce.date().nullable(),
  original_filename: z.string(),
  mime_type: z.string(),
  extension: z.string(),
  size_bytes: z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().positive()]).transform(Number),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  version_number: z.number().int().positive(),
  uploaded_at: z.coerce.date(),
  uploaded_by: z.string(),
  favorite: z.boolean(),
});
const orderOptionSchema = z.object({ id: uuidSchema, order_number: z.string(), client: z.string(), object: z.string(), address: z.string() });
const visitOptionSchema = z.object({ id: uuidSchema, order_id: uuidSchema, scheduled_start_at: z.coerce.date(), status: z.string() });
const downloadSchema = z.object({ id: uuidSchema, original_filename: z.string(), mime_type: z.string(), size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number), sha256: z.string().regex(/^[0-9a-f]{64}$/), storage_key: z.string() });

export class DocumentReferenceError extends Error {
  constructor(readonly field: "order" | "visit") {
    super(`The selected ${field} is unavailable.`);
    this.name = "DocumentReferenceError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document was not found.");
    this.name = "DocumentNotFoundError";
  }
}

function mapDocument(row: unknown): DocumentListItem {
  const document = documentRowSchema.parse(row);
  return {
    id: document.id,
    title: document.title,
    category: document.category,
    categoryLabel: documentCategoryLabels[document.category],
    description: document.description,
    clientId: document.client_id,
    clientName: document.client_name,
    objectId: document.object_id,
    objectName: document.object_name,
    objectAddress: document.object_address,
    orderId: document.order_id,
    orderNumber: document.order_number,
    visitId: document.visit_id,
    visitScheduledStartAt: document.visit_scheduled_start_at?.toISOString() ?? null,
    filename: document.original_filename,
    mimeType: document.mime_type,
    extension: document.extension,
    sizeBytes: document.size_bytes,
    sha256: document.sha256,
    versionNumber: document.version_number,
    uploadedAt: document.uploaded_at.toISOString(),
    uploadedBy: document.uploaded_by,
    favorite: document.favorite,
  };
}

export async function listDocuments(member: AuthenticatedMember): Promise<DocumentListItem[]> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`
    SELECT documents.id, documents.title, documents.category, documents.description,
      documents.client_id, clients.legal_name AS client_name,
      documents.object_id, client_objects.name AS object_name, client_objects.address AS object_address,
      documents.order_id, orders.order_number,
      documents.visit_id, service_visits.scheduled_start_at AS visit_scheduled_start_at,
      document_versions.original_filename, document_versions.mime_type, document_versions.extension,
      document_versions.size_bytes, document_versions.sha256, document_versions.version_number,
      document_versions.created_at AS uploaded_at, organization_members.display_name AS uploaded_by,
      (document_favorites.member_id IS NOT NULL) AS favorite
    FROM documents
    JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
    JOIN client_objects ON client_objects.organization_id = documents.organization_id AND client_objects.id = documents.object_id
    JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    JOIN organization_members ON organization_members.organization_id = documents.organization_id AND organization_members.id = document_versions.uploaded_by
    LEFT JOIN service_visits ON service_visits.organization_id = documents.organization_id AND service_visits.id = documents.visit_id
    LEFT JOIN document_favorites ON document_favorites.organization_id = documents.organization_id
      AND document_favorites.document_id = documents.id AND document_favorites.member_id = ${member.memberId}
    WHERE documents.organization_id = ${member.organizationId} AND documents.archived_at IS NULL
    ORDER BY documents.created_at DESC
    LIMIT 500
  `;
  return rows.map(mapDocument);
}

export async function listOrderDocuments(member: AuthenticatedMember, orderId: string): Promise<DocumentListItem[]> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`
    SELECT documents.id, documents.title, documents.category, documents.description,
      documents.client_id, clients.legal_name AS client_name,
      documents.object_id, client_objects.name AS object_name, client_objects.address AS object_address,
      documents.order_id, orders.order_number,
      documents.visit_id, service_visits.scheduled_start_at AS visit_scheduled_start_at,
      document_versions.original_filename, document_versions.mime_type, document_versions.extension,
      document_versions.size_bytes, document_versions.sha256, document_versions.version_number,
      document_versions.created_at AS uploaded_at, organization_members.display_name AS uploaded_by,
      (document_favorites.member_id IS NOT NULL) AS favorite
    FROM documents
    JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
    JOIN client_objects ON client_objects.organization_id = documents.organization_id AND client_objects.id = documents.object_id
    JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    JOIN organization_members ON organization_members.organization_id = documents.organization_id AND organization_members.id = document_versions.uploaded_by
    LEFT JOIN service_visits ON service_visits.organization_id = documents.organization_id AND service_visits.id = documents.visit_id
    LEFT JOIN document_favorites ON document_favorites.organization_id = documents.organization_id
      AND document_favorites.document_id = documents.id AND document_favorites.member_id = ${member.memberId}
    WHERE documents.organization_id = ${member.organizationId} AND documents.order_id = ${orderId} AND documents.archived_at IS NULL
    ORDER BY documents.created_at DESC
    LIMIT 100
  `;
  return rows.map(mapDocument);
}

export async function listDocumentUploadOptions(member: AuthenticatedMember): Promise<DocumentUploadOptions> {
  requirePermission(member, "documents.write");
  const sql = getDatabase();
  const [orderRows, visitRows] = await Promise.all([
    sql`SELECT id, order_number, client_name_snapshot AS client, object_name_snapshot AS object, object_address_snapshot AS address
      FROM orders WHERE organization_id = ${member.organizationId} AND status <> 'cancelled'
      ORDER BY created_at DESC LIMIT 300`,
    sql`SELECT id, order_id, scheduled_start_at, status FROM service_visits
      WHERE organization_id = ${member.organizationId} AND order_id IS NOT NULL
      ORDER BY scheduled_start_at DESC LIMIT 500`,
  ]);
  return {
    orders: orderRows.map((row) => { const order = orderOptionSchema.parse(row); return { id: order.id, number: order.order_number, client: order.client, object: order.object, address: order.address }; }),
    visits: visitRows.map((row) => { const visit = visitOptionSchema.parse(row); return { id: visit.id, orderId: visit.order_id, scheduledStartAt: visit.scheduled_start_at.toISOString(), status: visit.status }; }),
  };
}

export async function documentUploadExists(member: AuthenticatedMember, documentId: string) {
  requirePermission(member, "documents.write");
  const sql = getDatabase();
  const rows = await sql`SELECT id FROM documents WHERE organization_id = ${member.organizationId} AND id = ${documentId}`;
  return rows.length > 0;
}

export async function createDocument(
  member: AuthenticatedMember,
  input: CreateDocumentMetadataInput & { filename: string; mimeType: string; extension: string; sizeBytes: number; sha256: string; storageKey: string },
) {
  requirePermission(member, "documents.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const orderRows = await transaction`SELECT client_id, object_id FROM orders WHERE organization_id = ${member.organizationId} AND id = ${input.orderId}`;
    if (!orderRows.length) throw new DocumentReferenceError("order");
    if (input.visitId) {
      const visitRows = await transaction`SELECT id FROM service_visits WHERE organization_id = ${member.organizationId} AND id = ${input.visitId} AND order_id = ${input.orderId}`;
      if (!visitRows.length) throw new DocumentReferenceError("visit");
    }
    const order = z.object({ client_id: uuidSchema, object_id: uuidSchema }).parse(orderRows[0]);
    const existingRows = await transaction`SELECT id FROM documents WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
    if (existingRows.length) return input.idempotencyKey;

    await transaction`INSERT INTO documents (
      id, organization_id, client_id, object_id, order_id, visit_id, title, category, description, created_by
    ) VALUES (
      ${input.idempotencyKey}, ${member.organizationId}, ${order.client_id}, ${order.object_id}, ${input.orderId}, ${input.visitId},
      ${input.title}, ${input.category}, ${input.description}, ${member.memberId}
    )`;
    const versionRows = await transaction`INSERT INTO document_versions (
      organization_id, document_id, version_number, original_filename, storage_key, mime_type, extension,
      size_bytes, sha256, uploaded_by
    ) VALUES (
      ${member.organizationId}, ${input.idempotencyKey}, 1, ${input.filename}, ${input.storageKey}, ${input.mimeType},
      ${input.extension}, ${input.sizeBytes}, ${input.sha256}, ${member.memberId}
    ) RETURNING id`;
    const versionId = z.object({ id: uuidSchema }).parse(versionRows[0]).id;
    await transaction`UPDATE documents SET current_version_id = ${versionId} WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.created', 'document', ${input.idempotencyKey},
        ${transaction.json({ orderId: input.orderId, visitId: input.visitId, category: input.category, filename: input.filename, sizeBytes: input.sizeBytes, sha256: input.sha256 })})`;
    return input.idempotencyKey;
  });
}

export async function setDocumentFavorite(member: AuthenticatedMember, documentId: string, favorite: boolean) {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const existingRows = await sql`SELECT id FROM documents WHERE organization_id = ${member.organizationId} AND id = ${documentId} AND archived_at IS NULL`;
  if (!existingRows.length) throw new DocumentNotFoundError();
  if (favorite) {
    await sql`INSERT INTO document_favorites (organization_id, document_id, member_id)
      VALUES (${member.organizationId}, ${documentId}, ${member.memberId}) ON CONFLICT DO NOTHING`;
  } else {
    await sql`DELETE FROM document_favorites WHERE organization_id = ${member.organizationId} AND document_id = ${documentId} AND member_id = ${member.memberId}`;
  }
}

export async function getDocumentDownload(member: AuthenticatedMember, documentId: string): Promise<DocumentDownload> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`SELECT documents.id, document_versions.original_filename, document_versions.mime_type,
      document_versions.size_bytes, document_versions.sha256, document_versions.storage_key
    FROM documents
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${documentId} AND documents.archived_at IS NULL`;
  if (!rows.length) throw new DocumentNotFoundError();
  const document = downloadSchema.parse(rows[0]);
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.downloaded', 'document', ${document.id})`;
  return { id: document.id, filename: document.original_filename, mimeType: document.mime_type, sizeBytes: document.size_bytes, sha256: document.sha256, storageKey: document.storage_key };
}
