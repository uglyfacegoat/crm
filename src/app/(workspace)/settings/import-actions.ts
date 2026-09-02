"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { CsvParseError, parseCsv } from "@/server/imports/csv";
import { getImportValidationContext, saveImportDryRun, type ImportSourceFiles } from "@/server/imports/repository";
import { importDatasetNames, type ImportDryRunReport, type ImportIssue, type ImportPackageRows, type ImportValidationResult } from "@/server/imports/types";
import { validateImportPackage } from "@/server/imports/validation";

const maximumFileBytes = 2 * 1024 * 1024;
const maximumPackageBytes = 8 * 1024 * 1024;
const maximumRows = 50_000;
const allowedMimeTypes = new Set(["", "text/csv", "text/plain", "application/vnd.ms-excel"]);

export type ImportDryRunState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  report: ImportDryRunReport | null;
};

function uploadedCsv(formData: FormData, dataset: string) {
  const value = formData.get(`${dataset}File`);
  return value instanceof File && value.size > 0 ? value : null;
}

function unexpected(memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation: "import.dry_run.create", category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function createImportDryRunAction(_previous: ImportDryRunState, formData: FormData): Promise<ImportDryRunState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не выполняет проверку импорта.", fieldErrors: {}, report: null };
  const member = await requireSession();
  const files = importDatasetNames.map((dataset) => ({ dataset, file: uploadedCsv(formData, dataset) }))
    .filter((entry): entry is { dataset: (typeof importDatasetNames)[number]; file: File } => entry.file !== null);
  if (!files.length) return { status: "error", message: "Добавьте хотя бы один CSV-файл.", fieldErrors: { package: ["Пакет пуст"] }, report: null };

  const fieldErrors: Record<string, string[]> = {};
  let packageBytes = 0;
  for (const { dataset, file } of files) {
    packageBytes += file.size;
    if (!/^[^\u0000-\u001f]{1,255}$/.test(file.name)) fieldErrors[`${dataset}File`] = ["Имя файла должно содержать от 1 до 255 печатных символов"];
    else if (!file.name.toLowerCase().endsWith(".csv")) fieldErrors[`${dataset}File`] = ["Разрешён только файл с расширением .csv"];
    else if (!allowedMimeTypes.has(file.type.toLowerCase())) fieldErrors[`${dataset}File`] = ["Браузер сообщил неподдерживаемый тип файла"];
    else if (file.size > maximumFileBytes) fieldErrors[`${dataset}File`] = ["Размер одного CSV не должен превышать 2 МБ"];
  }
  if (packageBytes > maximumPackageBytes) fieldErrors.package = ["Общий размер пакета не должен превышать 8 МБ"];
  if (Object.keys(fieldErrors).length) return { status: "error", message: "Проверьте выбранные файлы.", fieldErrors, report: null };

  try {
    const packageHash = createHash("sha256");
    const sourceFiles: ImportSourceFiles = {};
    const packageRows: ImportPackageRows = {};
    const structuralIssues: ImportIssue[] = [];
    for (const { dataset, file } of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      sourceFiles[dataset] = { filename: file.name, sizeBytes: file.size, sha256: fileHash };
      packageHash.update(dataset).update("\0").update(String(buffer.length)).update("\0").update(buffer);
      try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        packageRows[dataset] = parseCsv(source);
      } catch (error) {
        structuralIssues.push({ dataset, rowNumber: 1, severity: "error", code: error instanceof CsvParseError ? "invalid_csv" : "invalid_utf8", field: null, message: error instanceof CsvParseError ? error.message : "CSV должен быть сохранён в кодировке UTF-8." });
      }
    }

    const allRows = Object.values(packageRows).reduce((total, parsed) => total + parsed.rows.length, 0);
    if (allRows > maximumRows) structuralIssues.push({ dataset: "package", rowNumber: 1, severity: "error", code: "row_limit_exceeded", field: null, message: "Пакет содержит больше 50 000 строк. Разделите выгрузку на несколько пакетов." });
    const values = Object.values(packageRows).flatMap((parsed) => parsed.rows.map((row) => row.values));
    const context = await getImportValidationContext(member, {
      taxIds: [...new Set(values.map((row) => row.tax_id).filter(Boolean))],
      orderNumbers: [...new Set(values.map((row) => row.order_number).filter(Boolean))],
      externalIds: [...new Set(values.flatMap((row) => Object.entries(row).filter(([key, value]) => key.endsWith("external_id") && value).map(([, value]) => value)))],
    });
    const checked = validateImportPackage(packageRows, context);
    const validation: ImportValidationResult = {
      ...checked,
      status: checked.errorCount + structuralIssues.length ? "blocked" : "ready",
      errorCount: checked.errorCount + structuralIssues.length,
      issues: [...structuralIssues, ...checked.issues].slice(0, 2_000),
    };
    const report = await saveImportDryRun(member, { fingerprint: packageHash.digest("hex"), sourceFiles, validation });
    revalidatePath("/settings");
    return { status: "success", message: report.reused ? "Этот пакет уже проверялся — показан исходный отчёт." : report.status === "ready" ? "Пакет прошёл dry-run и готов к этапу сопоставления." : "Проверка завершена: исправьте блокирующие ошибки.", fieldErrors: {}, report };
  } catch (error) {
    unexpected(member.memberId, error);
    return { status: "error", message: "Не удалось проверить пакет. Данные CRM не изменялись.", fieldErrors: {}, report: null };
  }
}
