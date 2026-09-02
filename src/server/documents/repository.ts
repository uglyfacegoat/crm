import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateDocumentMetadataInput, CreateDocumentVersionInput } from "./schemas";
import { buildDocumentArchiveTree, type DocumentArchiveBranch, type DocumentArchiveSelection, type DocumentArchiveTree } from "./archive";
import { documentCategoryLabels, type DocumentDownload, type DocumentExportFile, type DocumentListItem, type DocumentUploadOptions, type DocumentVersionListItem, type DocumentVersionUploadTarget } from "./types";

const uuidSchema = z.string().uuid();
const documentVersionRowSchema = z.object({
  id: uuidSchema,
  version_number: z.number().int().positive(),
  original_filename: z.string(),
  mime_type: z.string(),
  extension: z.string(),
  size_bytes: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(Number),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  change_note: z.string().nullable(),
  uploaded_at: z.coerce.date(),
  uploaded_by: z.string(),
  current: z.boolean(),
});
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
  record_version: z.number().int().positive(),
  uploaded_at: z.coerce.date(),
  uploaded_by: z.string(),
  favorite: z.boolean(),
  versions: z.array(documentVersionRowSchema),
});
const orderOptionSchema = z.object({ id: uuidSchema, order_number: z.string(), client: z.string(), object: z.string(), address: z.string() });
const visitOptionSchema = z.object({ id: uuidSchema, order_id: uuidSchema, scheduled_start_at: z.coerce.date(), status: z.string() });
const downloadSchema = z.object({ document_id: uuidSchema, version_id: uuidSchema, original_filename: z.string(), mime_type: z.string(), size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number), sha256: z.string().regex(/^[0-9a-f]{64}$/), storage_key: z.string() });
const exportFileSchema = downloadSchema.extend({ client_id: uuidSchema, client_name: z.string(), object_id: uuidSchema, object_name: z.string(), order_number: z.string(), category: z.enum(["contract", "act", "visit_card", "invoice", "receipt", "photo", "other"]) });
const archiveBranchRowSchema = z.object({
  client_id: uuidSchema,
  client_name: z.string(),
  object_id: uuidSchema,
  object_name: z.string(),
  object_address: z.string(),
  order_id: uuidSchema,
  order_number: z.string(),
  category: z.enum(["contract", "act", "visit_card", "invoice", "receipt", "photo", "other"]),
  document_count: z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]).transform(Number),
});

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

export class DocumentVersionConflictError extends Error {
  constructor() { super("The document was changed by another member."); this.name = "DocumentVersionConflictError"; }
}

export class DocumentVersionDuplicateContentError extends Error {
  constructor() { super("The uploaded file is identical to the current version."); this.name = "DocumentVersionDuplicateContentError"; }
}

export class DocumentVersionRequestConflictError extends Error {
  constructor() { super("The upload request identifier belongs to another document."); this.name = "DocumentVersionRequestConflictError"; }
}

function mapDocumentVersion(row: z.infer<typeof documentVersionRowSchema>): DocumentVersionListItem {
  return {
    id: row.id,
    versionNumber: row.version_number,
    filename: row.original_filename,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    changeNote: row.change_note,
    uploadedAt: row.uploaded_at.toISOString(),
    uploadedBy: row.uploaded_by,
    current: row.current,
  };
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
    recordVersion: document.record_version,
    uploadedAt: document.uploaded_at.toISOString(),
    uploadedBy: document.uploaded_by,
    favorite: document.favorite,
    versions: document.versions.map(mapDocumentVersion),
  };
}

export async function listDocuments(member: AuthenticatedMember, selection: DocumentArchiveSelection = { clientId: null, objectId: null, orderId: null, category: null }): Promise<DocumentListItem[]> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`
    SELECT documents.id, documents.title, documents.category, documents.description,
      documents.client_id, clients.legal_name AS client_name,
      documents.object_id, client_objects.name AS object_name, client_objects.address AS object_address,
      documents.order_id, orders.order_number,
      documents.visit_id, service_visits.scheduled_start_at AS visit_scheduled_start_at,
      document_versions.original_filename, document_versions.mime_type, document_versions.extension,
      document_versions.size_bytes, document_versions.sha256, document_versions.version_number, documents.version AS record_version,
      document_versions.created_at AS uploaded_at, organization_members.display_name AS uploaded_by,
      (document_favorites.member_id IS NOT NULL) AS favorite, version_history.versions
    FROM documents
    JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
    JOIN client_objects ON client_objects.organization_id = documents.organization_id AND client_objects.id = documents.object_id
    JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    JOIN organization_members ON organization_members.organization_id = documents.organization_id AND organization_members.id = document_versions.uploaded_by
    LEFT JOIN service_visits ON service_visits.organization_id = documents.organization_id AND service_visits.id = documents.visit_id
    LEFT JOIN document_favorites ON document_favorites.organization_id = documents.organization_id
      AND document_favorites.document_id = documents.id AND document_favorites.member_id = ${member.memberId}
    JOIN LATERAL (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', history.id, 'version_number', history.version_number, 'original_filename', history.original_filename,
        'mime_type', history.mime_type, 'extension', history.extension, 'size_bytes', history.size_bytes,
        'sha256', history.sha256, 'change_note', history.change_note, 'uploaded_at', history.created_at,
        'uploaded_by', uploaders.display_name, 'current', history.id = documents.current_version_id
      ) ORDER BY history.version_number DESC), '[]'::jsonb) AS versions
      FROM document_versions history
      JOIN organization_members uploaders ON uploaders.organization_id = history.organization_id AND uploaders.id = history.uploaded_by
      WHERE history.organization_id = documents.organization_id AND history.document_id = documents.id
    ) version_history ON true
    WHERE documents.organization_id = ${member.organizationId} AND documents.archived_at IS NULL
      AND (${selection.clientId}::uuid IS NULL OR documents.client_id = ${selection.clientId}::uuid)
      AND (${selection.objectId}::uuid IS NULL OR documents.object_id = ${selection.objectId}::uuid)
      AND (${selection.orderId}::uuid IS NULL OR documents.order_id = ${selection.orderId}::uuid)
      AND (${selection.category}::text IS NULL OR documents.category = ${selection.category}::text)
    ORDER BY documents.created_at DESC
    LIMIT 500
  `;
  return rows.map(mapDocument);
}

export async function getDocumentArchiveTree(member: AuthenticatedMember): Promise<DocumentArchiveTree> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`
    SELECT
      documents.client_id,
      clients.legal_name AS client_name,
      documents.object_id,
      client_objects.name AS object_name,
      client_objects.address AS object_address,
      documents.order_id,
      orders.order_number,
      documents.category,
      count(*) AS document_count
    FROM documents
    JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
    JOIN client_objects ON client_objects.organization_id = documents.organization_id AND client_objects.id = documents.object_id
    JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
    WHERE documents.organization_id = ${member.organizationId} AND documents.archived_at IS NULL
    GROUP BY documents.client_id, clients.legal_name, documents.object_id, client_objects.name,
      client_objects.address, documents.order_id, orders.order_number, orders.created_at, documents.category
    ORDER BY lower(clients.legal_name), lower(client_objects.name), orders.created_at DESC,
      CASE documents.category
        WHEN 'contract' THEN 1 WHEN 'act' THEN 2 WHEN 'visit_card' THEN 3 WHEN 'invoice' THEN 4
        WHEN 'receipt' THEN 5 WHEN 'photo' THEN 6 ELSE 7
      END
  `;
  const branches: DocumentArchiveBranch[] = rows.map((row) => {
    const branch = archiveBranchRowSchema.parse(row);
    return {
      clientId: branch.client_id,
      clientName: branch.client_name,
      objectId: branch.object_id,
      objectName: branch.object_name,
      objectAddress: branch.object_address,
      orderId: branch.order_id,
      orderNumber: branch.order_number,
      category: branch.category,
      documentCount: branch.document_count,
    };
  });
  return buildDocumentArchiveTree(branches);
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
      document_versions.size_bytes, document_versions.sha256, document_versions.version_number, documents.version AS record_version,
      document_versions.created_at AS uploaded_at, organization_members.display_name AS uploaded_by,
      (document_favorites.member_id IS NOT NULL) AS favorite, version_history.versions
    FROM documents
    JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
    JOIN client_objects ON client_objects.organization_id = documents.organization_id AND client_objects.id = documents.object_id
    JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    JOIN organization_members ON organization_members.organization_id = documents.organization_id AND organization_members.id = document_versions.uploaded_by
    LEFT JOIN service_visits ON service_visits.organization_id = documents.organization_id AND service_visits.id = documents.visit_id
    LEFT JOIN document_favorites ON document_favorites.organization_id = documents.organization_id
      AND document_favorites.document_id = documents.id AND document_favorites.member_id = ${member.memberId}
    JOIN LATERAL (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', history.id, 'version_number', history.version_number, 'original_filename', history.original_filename,
        'mime_type', history.mime_type, 'extension', history.extension, 'size_bytes', history.size_bytes,
        'sha256', history.sha256, 'change_note', history.change_note, 'uploaded_at', history.created_at,
        'uploaded_by', uploaders.display_name, 'current', history.id = documents.current_version_id
      ) ORDER BY history.version_number DESC), '[]'::jsonb) AS versions
      FROM document_versions history
      JOIN organization_members uploaders ON uploaders.organization_id = history.organization_id AND uploaders.id = history.uploaded_by
      WHERE history.organization_id = documents.organization_id AND history.document_id = documents.id
    ) version_history ON true
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
    sql`WITH recent_orders AS (
        SELECT id FROM orders
        WHERE organization_id = ${member.organizationId} AND status <> 'cancelled'
        ORDER BY created_at DESC
        LIMIT 300
      ), ranked_visits AS (
        SELECT service_visits.id, service_visits.order_id, service_visits.scheduled_start_at, service_visits.status,
          row_number() OVER (PARTITION BY service_visits.order_id ORDER BY service_visits.scheduled_start_at DESC, service_visits.id DESC) AS order_rank
        FROM service_visits
        JOIN recent_orders ON recent_orders.id = service_visits.order_id
        WHERE service_visits.organization_id = ${member.organizationId}
      )
      SELECT id, order_id, scheduled_start_at, status FROM ranked_visits
      WHERE order_rank <= 20
      ORDER BY scheduled_start_at DESC`,
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
    await transaction`INSERT INTO notifications (
        organization_id, recipient_member_id, kind, severity, title, body, source_type, source_id,
        target_type, target_id, event_key, occurred_at
      )
      SELECT documents.organization_id, recipients.id, 'document_uploaded', 'info', 'Добавлен документ',
        documents.title || E'\nЗаказ №' || orders.order_number || ' · ' || clients.legal_name,
        'document', documents.id, 'document', documents.id,
        'document_uploaded:' || documents.id::text || ':' || ${versionId}::text, now()
      FROM documents
      JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
      JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
      JOIN organization_members recipients ON recipients.organization_id = documents.organization_id
        AND recipients.active AND recipients.role <> 'master' AND recipients.id <> ${member.memberId}
      WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${input.idempotencyKey}
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO NOTHING`;
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

export async function documentVersionUploadExists(member: AuthenticatedMember, versionId: string, documentId: string) {
  requirePermission(member, "documents.write");
  const sql = getDatabase();
  const rows = await sql`SELECT document_id FROM document_versions
    WHERE organization_id = ${member.organizationId} AND id = ${versionId}`;
  if (!rows.length) return false;
  const existingDocumentId = uuidSchema.parse(rows[0].document_id);
  if (existingDocumentId !== documentId) throw new DocumentVersionRequestConflictError();
  return true;
}

export async function getDocumentVersionUploadTarget(member: AuthenticatedMember, documentId: string, expectedVersion: number): Promise<DocumentVersionUploadTarget> {
  requirePermission(member, "documents.write");
  const sql = getDatabase();
  const rows = await sql`SELECT documents.id, documents.order_id, documents.version AS record_version, document_versions.version_number
    FROM documents
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${documentId} AND documents.archived_at IS NULL`;
  if (!rows.length) throw new DocumentNotFoundError();
  const target = z.object({ id: uuidSchema, order_id: uuidSchema, record_version: z.number().int().positive(), version_number: z.number().int().positive() }).parse(rows[0]);
  if (target.record_version !== expectedVersion) throw new DocumentVersionConflictError();
  return { documentId: target.id, orderId: target.order_id, recordVersion: target.record_version, versionNumber: target.version_number + 1 };
}

export async function createDocumentVersion(
  member: AuthenticatedMember,
  input: CreateDocumentVersionInput & { versionNumber: number; filename: string; mimeType: string; extension: string; sizeBytes: number; sha256: string; storageKey: string },
) {
  requirePermission(member, "documents.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const existingVersions = await transaction`SELECT document_id, version_number FROM document_versions
      WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
    if (existingVersions.length) {
      const existing = z.object({ document_id: uuidSchema, version_number: z.number().int().positive() }).parse(existingVersions[0]);
      if (existing.document_id !== input.documentId) throw new DocumentVersionRequestConflictError();
      return existing.version_number;
    }

    const documentRows = await transaction`SELECT documents.version AS record_version, documents.current_version_id,
        current_version.version_number, current_version.sha256
      FROM documents
      JOIN document_versions current_version ON current_version.organization_id = documents.organization_id AND current_version.id = documents.current_version_id
      WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${input.documentId} AND documents.archived_at IS NULL
      FOR UPDATE OF documents`;
    if (!documentRows.length) throw new DocumentNotFoundError();
    const document = z.object({ record_version: z.number().int().positive(), current_version_id: uuidSchema, version_number: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).parse(documentRows[0]);
    if (document.record_version !== input.expectedVersion || document.version_number + 1 !== input.versionNumber) throw new DocumentVersionConflictError();
    if (document.sha256 === input.sha256) throw new DocumentVersionDuplicateContentError();

    await transaction`INSERT INTO document_versions (
      id, organization_id, document_id, version_number, original_filename, storage_key, mime_type, extension,
      size_bytes, sha256, uploaded_by, change_note
    ) VALUES (
      ${input.idempotencyKey}, ${member.organizationId}, ${input.documentId}, ${input.versionNumber}, ${input.filename}, ${input.storageKey},
      ${input.mimeType}, ${input.extension}, ${input.sizeBytes}, ${input.sha256}, ${member.memberId}, ${input.changeNote}
    )`;
    const updatedDocuments = await transaction`UPDATE documents SET current_version_id = ${input.idempotencyKey},
        version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.documentId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updatedDocuments.length) throw new DocumentVersionConflictError();
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.version_created', 'document', ${input.documentId},
        ${transaction.json({ versionId: input.idempotencyKey, versionNumber: input.versionNumber, filename: input.filename, sizeBytes: input.sizeBytes, sha256: input.sha256, changeNote: input.changeNote })})`;
    await transaction`INSERT INTO notifications (
        organization_id, recipient_member_id, kind, severity, title, body, source_type, source_id,
        target_type, target_id, event_key, occurred_at
      )
      SELECT documents.organization_id, recipients.id, 'document_uploaded', 'info', 'Новая версия документа',
        documents.title || ' · версия ' || ${input.versionNumber}::text || E'\nЗаказ №' || orders.order_number,
        'document', documents.id, 'document', documents.id,
        'document_uploaded:' || documents.id::text || ':' || ${input.idempotencyKey}::text, now()
      FROM documents
      JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
      JOIN organization_members recipients ON recipients.organization_id = documents.organization_id
        AND recipients.active AND recipients.role <> 'master' AND recipients.id <> ${member.memberId}
      WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${input.documentId}
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO NOTHING`;
    return input.versionNumber;
  });
}

export async function getDocumentDownload(member: AuthenticatedMember, documentId: string): Promise<DocumentDownload> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`SELECT documents.id AS document_id, document_versions.id AS version_id,
      document_versions.original_filename, document_versions.mime_type,
      document_versions.size_bytes, document_versions.sha256, document_versions.storage_key
    FROM documents
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${documentId} AND documents.archived_at IS NULL`;
  if (!rows.length) throw new DocumentNotFoundError();
  const document = downloadSchema.parse(rows[0]);
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.downloaded', 'document', ${document.document_id})`;
  return { id: document.version_id, documentId: document.document_id, filename: document.original_filename, mimeType: document.mime_type, sizeBytes: document.size_bytes, sha256: document.sha256, storageKey: document.storage_key };
}

export async function getDocumentVersionDownload(member: AuthenticatedMember, documentId: string, versionId: string): Promise<DocumentDownload> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`SELECT documents.id AS document_id, document_versions.id AS version_id,
      document_versions.original_filename, document_versions.mime_type, document_versions.size_bytes,
      document_versions.sha256, document_versions.storage_key
    FROM documents
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.document_id = documents.id
    WHERE documents.organization_id = ${member.organizationId} AND documents.id = ${documentId}
      AND document_versions.id = ${versionId} AND documents.archived_at IS NULL`;
  if (!rows.length) throw new DocumentNotFoundError();
  const document = downloadSchema.parse(rows[0]);
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.version_downloaded', 'document_version', ${document.version_id},
      ${sql.json({ documentId: document.document_id })})`;
  return { id: document.version_id, documentId: document.document_id, filename: document.original_filename, mimeType: document.mime_type, sizeBytes: document.size_bytes, sha256: document.sha256, storageKey: document.storage_key };
}

export async function getDocumentBatchExport(member: AuthenticatedMember, documentIds: string[]): Promise<DocumentExportFile[]> {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  const rows = await sql`SELECT documents.id AS document_id, document_versions.id AS version_id,
      document_versions.original_filename, document_versions.mime_type, document_versions.size_bytes,
      document_versions.sha256, document_versions.storage_key, documents.client_id, clients.legal_name AS client_name,
      documents.object_id, client_objects.name AS object_name, orders.order_number, documents.category
    FROM documents
    JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
    JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
    JOIN client_objects ON client_objects.organization_id = documents.organization_id AND client_objects.id = documents.object_id
    JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
    WHERE documents.organization_id = ${member.organizationId} AND documents.id = ANY(${documentIds}::uuid[])
      AND documents.archived_at IS NULL
    ORDER BY lower(clients.legal_name), lower(client_objects.name), orders.order_number, lower(document_versions.original_filename)`;
  if (rows.length !== documentIds.length) throw new DocumentNotFoundError();
  return rows.map((row) => {
    const file = exportFileSchema.parse(row);
    return {
      id: file.version_id,
      documentId: file.document_id,
      filename: file.original_filename,
      mimeType: file.mime_type,
      sizeBytes: file.size_bytes,
      sha256: file.sha256,
      storageKey: file.storage_key,
      clientId: file.client_id,
      clientName: file.client_name,
      objectId: file.object_id,
      objectName: file.object_name,
      orderNumber: file.order_number,
      category: file.category,
    };
  });
}

export async function recordDocumentBatchExport(member: AuthenticatedMember, files: DocumentExportFile[], totalSizeBytes: number) {
  requirePermission(member, "documents.read");
  const sql = getDatabase();
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'documents.batch_exported', 'organization', ${member.organizationId},
      ${sql.json({ documentIds: files.map((file) => file.documentId), documentCount: files.length, totalSizeBytes, format: "zip" })})`;
}
