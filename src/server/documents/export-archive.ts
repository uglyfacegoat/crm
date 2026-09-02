import { createHash } from "node:crypto";
import { extname } from "node:path";
import { zipSync } from "fflate";
import { documentCategoryLabels, type DocumentExportFile } from "./types.ts";

export const MAX_DOCUMENT_EXPORT_FILES = 30;
export const MAX_DOCUMENT_EXPORT_BYTES = 50 * 1024 * 1024;

export class DocumentExportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExportLimitError";
  }
}

export class DocumentExportIntegrityError extends Error {
  readonly documentId: string;

  constructor(documentId: string) {
    super("Document content does not match its stored integrity metadata.");
    this.name = "DocumentExportIntegrityError";
    this.documentId = documentId;
  }
}

const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function safeArchiveSegment(value: string, fallback: string) {
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 90)
    .replace(/[. ]+$/g, "");
  const segment = normalized || fallback;
  return windowsReservedName.test(segment) ? `_${segment}` : segment;
}

function uniqueArchivePath(path: string, occupiedPaths: Set<string>) {
  if (!occupiedPaths.has(path.toLocaleLowerCase("ru"))) {
    occupiedPaths.add(path.toLocaleLowerCase("ru"));
    return path;
  }
  const extension = extname(path);
  const stem = extension ? path.slice(0, -extension.length) : path;
  for (let index = 2; index <= MAX_DOCUMENT_EXPORT_FILES; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    const normalizedCandidate = candidate.toLocaleLowerCase("ru");
    if (!occupiedPaths.has(normalizedCandidate)) {
      occupiedPaths.add(normalizedCandidate);
      return candidate;
    }
  }
  throw new Error("Unable to create a unique document path in the archive.");
}

export function createDocumentArchivePath(file: DocumentExportFile, occupiedPaths: Set<string>) {
  const client = `${safeArchiveSegment(file.clientName, "Клиент")} [${file.clientId.slice(0, 8)}]`;
  const object = `${safeArchiveSegment(file.objectName, "Объект")} [${file.objectId.slice(0, 8)}]`;
  const order = `Заказ ${safeArchiveSegment(file.orderNumber, "без номера")}`;
  const category = documentCategoryLabels[file.category];
  const filename = safeArchiveSegment(file.filename, `document-${file.documentId.slice(0, 8)}`);
  return uniqueArchivePath(`${client}/${object}/${order}/${category}/${filename}`, occupiedPaths);
}

export function createDocumentExportArchive(files: Array<DocumentExportFile & { content: Buffer }>) {
  if (!files.length || files.length > MAX_DOCUMENT_EXPORT_FILES) {
    throw new DocumentExportLimitError(`В один архив можно добавить от 1 до ${MAX_DOCUMENT_EXPORT_FILES} документов.`);
  }
  const totalSizeBytes = files.reduce((total, file) => total + file.content.length, 0);
  if (totalSizeBytes > MAX_DOCUMENT_EXPORT_BYTES) {
    throw new DocumentExportLimitError("Общий размер выбранных документов не должен превышать 50 МБ.");
  }

  const occupiedPaths = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    const actualSha256 = createHash("sha256").update(file.content).digest("hex");
    if (file.content.length !== file.sizeBytes || actualSha256 !== file.sha256) {
      throw new DocumentExportIntegrityError(file.documentId);
    }
    entries[createDocumentArchivePath(file, occupiedPaths)] = file.content;
  }
  return { archive: Buffer.from(zipSync(entries, { level: 0 })), totalSizeBytes };
}
