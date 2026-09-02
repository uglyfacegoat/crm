import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { ImportDatasetName, ImportDryRunReport, ImportIssue, ImportJobListItem, ImportValidationContext, ImportValidationResult } from "./types";

const datasetNameSchema = z.enum(["clients", "objects", "orders", "services", "documents"]);
const countSummarySchema = z.object({ counts: z.record(datasetNameSchema, z.number().int().nonnegative()) });
const sourceFilesSchema = z.partialRecord(datasetNameSchema, z.object({ filename: z.string(), sizeBytes: z.number().int().nonnegative(), sha256: z.string().length(64) }));
const jobRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["ready", "blocked", "applied"]),
  total_rows: z.number().int().nonnegative(),
  error_count: z.number().int().nonnegative(),
  warning_count: z.number().int().nonnegative(),
  source_files: sourceFilesSchema,
  summary: countSummarySchema,
  created_at: z.coerce.date(),
  created_by_name: z.string(),
});
const issueRowSchema = z.object({
  dataset: z.enum(["package", "clients", "objects", "orders", "services", "documents"]),
  row_number: z.number().int().positive(),
  severity: z.enum(["error", "warning"]),
  code: z.string(), field: z.string().nullable(), message: z.string(),
});

export type ImportSourceFiles = Partial<Record<ImportDatasetName, { filename: string; sizeBytes: number; sha256: string }>>;

function mapJob(value: unknown): ImportJobListItem {
  const row = jobRowSchema.parse(value);
  return {
    id: row.id,
    status: row.status,
    totalRows: row.total_rows,
    errorCount: row.error_count,
    warningCount: row.warning_count,
    sourceFiles: Object.fromEntries(Object.entries(row.source_files).map(([dataset, descriptor]) => [dataset, descriptor.filename])),
    counts: row.summary.counts,
    createdAt: row.created_at.toISOString(),
    createdByName: row.created_by_name,
  };
}

function mapIssue(value: unknown): ImportIssue {
  const row = issueRowSchema.parse(value);
  return { dataset: row.dataset, rowNumber: row.row_number, severity: row.severity, code: row.code, field: row.field, message: row.message };
}

export async function getImportValidationContext(member: AuthenticatedMember, candidates: {
  taxIds: string[];
  orderNumbers: string[];
  externalIds: string[];
}): Promise<ImportValidationContext> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const [clientRows, orderRows, linkRows] = await Promise.all([
    candidates.taxIds.length ? sql`SELECT tax_id FROM clients WHERE organization_id = ${member.organizationId} AND tax_id = ANY(${candidates.taxIds})` : [],
    candidates.orderNumbers.length ? sql`SELECT order_number FROM orders WHERE organization_id = ${member.organizationId} AND order_number = ANY(${candidates.orderNumbers})` : [],
    candidates.externalIds.length ? sql`SELECT record_type, external_id FROM import_record_links WHERE organization_id = ${member.organizationId} AND source_format = 'crm_csv_v1' AND external_id = ANY(${candidates.externalIds})` : [],
  ]);
  return {
    existingClientTaxIds: new Set(clientRows.map((row) => z.string().parse(row.tax_id))),
    existingOrderNumbers: new Set(orderRows.map((row) => z.string().parse(row.order_number))),
    existingLinks: new Set(linkRows.map((row) => `${z.string().parse(row.record_type)}:${z.string().parse(row.external_id)}`)),
  };
}

async function loadReport(transaction: ReturnType<typeof getDatabase>, organizationId: string, jobId: string, reused: boolean): Promise<ImportDryRunReport> {
  const [jobRows, issueRows] = await Promise.all([
    transaction`SELECT import_jobs.id, import_jobs.status, import_jobs.total_rows, import_jobs.error_count,
        import_jobs.warning_count, import_jobs.source_files, import_jobs.summary, import_jobs.created_at,
        organization_members.display_name AS created_by_name
      FROM import_jobs JOIN organization_members ON organization_members.organization_id = import_jobs.organization_id
        AND organization_members.id = import_jobs.created_by
      WHERE import_jobs.organization_id = ${organizationId} AND import_jobs.id = ${jobId}`,
    transaction`SELECT dataset, row_number, severity, code, field, message FROM import_job_issues
      WHERE organization_id = ${organizationId} AND import_job_id = ${jobId}
      ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END, dataset, row_number, id LIMIT 2000`,
  ]);
  if (!jobRows[0]) throw new Error("Import job was not found after creation.");
  return { ...mapJob(jobRows[0]), issues: issueRows.map(mapIssue), reused };
}

export async function saveImportDryRun(member: AuthenticatedMember, input: {
  fingerprint: string;
  sourceFiles: ImportSourceFiles;
  validation: ImportValidationResult;
}): Promise<ImportDryRunReport> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const outcome = await sql.begin(async (transaction) => {
    const inserted = await transaction`INSERT INTO import_jobs (
        organization_id, source_format, package_fingerprint, source_files, status, total_rows,
        error_count, warning_count, summary, created_by
      ) VALUES (${member.organizationId}, 'crm_csv_v1', ${input.fingerprint}, ${transaction.json(input.sourceFiles)},
        ${input.validation.status}, ${input.validation.totalRows}, ${input.validation.errorCount}, ${input.validation.warningCount},
        ${transaction.json({ counts: input.validation.counts })}, ${member.memberId})
      ON CONFLICT (organization_id, package_fingerprint) DO NOTHING RETURNING id`;
    if (!inserted.length) {
      const [existing] = await transaction`SELECT id FROM import_jobs WHERE organization_id = ${member.organizationId} AND package_fingerprint = ${input.fingerprint}`;
      return { jobId: z.string().uuid().parse(existing?.id), reused: true };
    }
    const jobId = z.string().uuid().parse(inserted[0].id);
    if (input.validation.issues.length) {
      const rows = input.validation.issues.map((issue) => ({
        organization_id: member.organizationId, import_job_id: jobId, dataset: issue.dataset,
        row_number: issue.rowNumber, severity: issue.severity, code: issue.code, field: issue.field, message: issue.message,
      }));
      await transaction`INSERT INTO import_job_issues ${transaction(rows, "organization_id", "import_job_id", "dataset", "row_number", "severity", "code", "field", "message")}`;
    }
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'import.dry_run.create', 'import_job', ${jobId},
        ${transaction.json({ status: input.validation.status, totalRows: input.validation.totalRows, errorCount: input.validation.errorCount, warningCount: input.validation.warningCount, fingerprint: input.fingerprint })})`;
    return { jobId, reused: false };
  });
  return loadReport(sql, member.organizationId, outcome.jobId, outcome.reused);
}

export async function listRecentImportJobs(member: AuthenticatedMember): Promise<ImportJobListItem[]> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const rows = await sql`SELECT import_jobs.id, import_jobs.status, import_jobs.total_rows, import_jobs.error_count,
      import_jobs.warning_count, import_jobs.source_files, import_jobs.summary, import_jobs.created_at,
      organization_members.display_name AS created_by_name
    FROM import_jobs JOIN organization_members ON organization_members.organization_id = import_jobs.organization_id
      AND organization_members.id = import_jobs.created_by
    WHERE import_jobs.organization_id = ${member.organizationId}
    ORDER BY import_jobs.created_at DESC LIMIT 12`;
  return rows.map(mapJob);
}
