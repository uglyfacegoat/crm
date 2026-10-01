import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateDocumentTemplateInput, UpdateDocumentTemplateStatusInput } from "./schemas";
import type { DocumentTemplateDownload, DocumentTemplateListItem, OrderGenerationTemplate } from "./types";

const templateRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  template_kind: z.literal("closing_act"),
  active: z.boolean(),
  original_filename: z.string(),
  mime_type: z.string(),
  extension: z.enum(["pdf", "docx"]),
  size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  version_number: z.number().int().positive(),
  uploaded_at: z.coerce.date(),
  uploaded_by: z.string(),
  version: z.number().int().positive(),
  generation_kind: z.enum(["pdf_form", "docx_placeholders"]).nullable().optional(),
  generation_fields: z.array(z.string()).optional(),
  generation_defaults: z.record(z.string(), z.string()).optional(),
});

const downloadRowSchema = z.object({
  id: z.string().uuid(),
  original_filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  storage_key: z.string(),
});

export class DocumentTemplateNotFoundError extends Error {
  constructor() { super("Document template was not found."); this.name = "DocumentTemplateNotFoundError"; }
}

export class DocumentTemplateVersionConflictError extends Error {
  constructor() { super("Document template was changed by another administrator."); this.name = "DocumentTemplateVersionConflictError"; }
}

function mapTemplate(value: unknown): DocumentTemplateListItem {
  const template = templateRowSchema.parse(value);
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    kind: template.template_kind,
    active: template.active,
    filename: template.original_filename,
    mimeType: template.mime_type,
    extension: template.extension,
    sizeBytes: template.size_bytes,
    sha256: template.sha256,
    versionNumber: template.version_number,
    uploadedAt: template.uploaded_at.toISOString(),
    uploadedBy: template.uploaded_by,
    version: template.version,
    generationKind: template.generation_kind ?? null,
    generationFields: (template.generation_fields ?? []) as DocumentTemplateListItem["generationFields"],
    generationDefaults: template.generation_defaults ?? {},
  };
}

export async function listDocumentTemplates(member: AuthenticatedMember): Promise<DocumentTemplateListItem[]> {
  requirePermission(member, "document_templates.read");
  const includeInactive = hasPermission(member, "document_templates.write");
  const sql = getDatabase();
  const rows = await sql`SELECT document_templates.id, document_templates.title, document_templates.description,
      document_templates.template_kind, document_templates.active, document_templates.version,
      document_template_versions.original_filename, document_template_versions.mime_type,
      document_template_versions.generation_kind, document_template_versions.generation_fields, document_template_versions.generation_defaults,
      document_template_versions.extension, document_template_versions.size_bytes, document_template_versions.sha256,
      document_template_versions.version_number, document_template_versions.created_at AS uploaded_at,
      organization_members.display_name AS uploaded_by
    FROM document_templates
    JOIN document_template_versions ON document_template_versions.organization_id = document_templates.organization_id
      AND document_template_versions.id = document_templates.current_version_id
    JOIN organization_members ON organization_members.organization_id = document_templates.organization_id
      AND organization_members.id = document_template_versions.uploaded_by
    WHERE document_templates.organization_id = ${member.organizationId}
      AND (${includeInactive} OR document_templates.active)
    ORDER BY document_templates.active DESC, document_templates.updated_at DESC
    LIMIT 100`;
  return rows.map(mapTemplate);
}

export async function documentTemplateExists(member: AuthenticatedMember, templateId: string) {
  requirePermission(member, "document_templates.write");
  const sql = getDatabase();
  const rows = await sql`SELECT id FROM document_templates WHERE organization_id = ${member.organizationId} AND id = ${templateId}`;
  return rows.length > 0;
}

export async function createDocumentTemplate(
  member: AuthenticatedMember,
  input: CreateDocumentTemplateInput & { filename: string; mimeType: string; extension: "pdf" | "docx"; sizeBytes: number; sha256: string; storageKey: string; generationKind?: "pdf_form" | "docx_placeholders" | null; generationFields?: string[]; generationDefaults?: Record<string, string> },
) {
  requirePermission(member, "document_templates.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const existing = await transaction`SELECT id FROM document_templates WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
    if (existing.length) return input.idempotencyKey;
    await transaction`INSERT INTO document_templates
      (id, organization_id, title, description, template_kind, created_by)
      VALUES (${input.idempotencyKey}, ${member.organizationId}, ${input.title}, ${input.description}, ${input.kind}, ${member.memberId})`;
    const [createdVersion] = await transaction`INSERT INTO document_template_versions
      (organization_id, template_id, version_number, original_filename, storage_key, mime_type, extension, size_bytes, sha256, uploaded_by, generation_kind, generation_fields, generation_defaults)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 1, ${input.filename}, ${input.storageKey}, ${input.mimeType},
        ${input.extension}, ${input.sizeBytes}, ${input.sha256}, ${member.memberId}, ${input.generationKind ?? null}, ${input.generationFields ?? []}, ${transaction.json(input.generationDefaults ?? {})}) RETURNING id`;
    const versionId = z.object({ id: z.string().uuid() }).parse(createdVersion).id;
    await transaction`UPDATE document_templates SET current_version_id = ${versionId}
      WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document_template.created', 'document_template', ${input.idempotencyKey},
        ${transaction.json({ kind: input.kind, filename: input.filename, sizeBytes: input.sizeBytes, sha256: input.sha256 })})`;
    return input.idempotencyKey;
  });
}

export async function updateDocumentTemplateStatus(member: AuthenticatedMember, input: UpdateDocumentTemplateStatusInput) {
  requirePermission(member, "document_templates.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [updated] = await transaction`UPDATE document_templates SET active = ${input.active}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.templateId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updated) {
      const exists = await transaction`SELECT id FROM document_templates WHERE organization_id = ${member.organizationId} AND id = ${input.templateId}`;
      if (!exists.length) throw new DocumentTemplateNotFoundError();
      throw new DocumentTemplateVersionConflictError();
    }
    const version = z.object({ version: z.number().int().positive() }).parse(updated).version;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document_template.status_updated', 'document_template', ${input.templateId},
        ${transaction.json({ active: input.active, version })})`;
    return version;
  });
}

export async function getDocumentTemplateDownload(member: AuthenticatedMember, templateId: string): Promise<DocumentTemplateDownload> {
  requirePermission(member, "document_templates.read");
  const canReadInactive = hasPermission(member, "document_templates.write");
  const sql = getDatabase();
  const rows = await sql`SELECT document_templates.id, document_template_versions.original_filename,
      document_template_versions.mime_type, document_template_versions.size_bytes,
      document_template_versions.sha256, document_template_versions.storage_key
    FROM document_templates
    JOIN document_template_versions ON document_template_versions.organization_id = document_templates.organization_id
      AND document_template_versions.id = document_templates.current_version_id
    WHERE document_templates.organization_id = ${member.organizationId} AND document_templates.id = ${templateId}
      AND (${canReadInactive} OR document_templates.active)`;
  if (!rows.length) throw new DocumentTemplateNotFoundError();
  const template = downloadRowSchema.parse(rows[0]);
  await sql`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document_template.downloaded', 'document_template', ${template.id})`;
  return { id: template.id, filename: template.original_filename, mimeType: template.mime_type, sizeBytes: template.size_bytes, sha256: template.sha256, storageKey: template.storage_key };
}


export async function listOrderGenerationTemplates(member: AuthenticatedMember): Promise<OrderGenerationTemplate[]> {
  requirePermission(member, "orders.read");
  requirePermission(member, "documents.read");
  requirePermission(member, "documents.write");
  const rows = await getDatabase()`SELECT templates.id, templates.title, templates.version, versions.extension,
      versions.generation_kind, versions.generation_fields, versions.generation_defaults
    FROM document_templates templates JOIN document_template_versions versions
      ON versions.organization_id = templates.organization_id AND versions.id = templates.current_version_id
    WHERE templates.organization_id = ${member.organizationId} AND templates.active
    ORDER BY (versions.generation_kind IS NOT NULL) DESC, templates.title, templates.id`;
  return rows.map(row => ({ id: row.id as string, title: row.title as string, version: row.version as number,
    extension: row.extension as "pdf" | "docx", generationKind: row.generation_kind as OrderGenerationTemplate["generationKind"],
    generationFields: row.generation_fields as OrderGenerationTemplate["generationFields"], generationDefaults: row.generation_defaults as Record<string, string> }));
}
