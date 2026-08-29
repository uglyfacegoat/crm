import { createHash } from "node:crypto";
import { extname } from "node:path";

export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;

type AllowedDocumentFile = {
  extension: "pdf" | "jpg" | "png" | "webp" | "docx" | "xlsx";
  mimeType: string;
};

const allowedFiles: Record<string, AllowedDocumentFile> = {
  pdf: { extension: "pdf", mimeType: "application/pdf" },
  jpg: { extension: "jpg", mimeType: "image/jpeg" },
  jpeg: { extension: "jpg", mimeType: "image/jpeg" },
  png: { extension: "png", mimeType: "image/png" },
  webp: { extension: "webp", mimeType: "image/webp" },
  docx: { extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { extension: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
};

export class DocumentFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFileValidationError";
  }
}

function startsWith(buffer: Buffer, signature: number[]) {
  return signature.every((byte, index) => buffer[index] === byte);
}

function hasValidSignature(buffer: Buffer, extension: AllowedDocumentFile["extension"]) {
  if (extension === "pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === "jpg") return startsWith(buffer, [0xff, 0xd8, 0xff]);
  if (extension === "png") return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === "webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return false;
  const archiveText = buffer.toString("latin1");
  return archiveText.includes("[Content_Types].xml") && archiveText.includes(extension === "docx" ? "word/" : "xl/");
}

function safeOriginalFilename(filename: string) {
  const basename = filename.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!basename || basename.length > 255) throw new DocumentFileValidationError("Имя файла должно содержать от 1 до 255 символов.");
  return basename;
}

export function validateDocumentFile(input: { filename: string; declaredMimeType: string; buffer: Buffer }) {
  const filename = safeOriginalFilename(input.filename);
  if (!input.buffer.length) throw new DocumentFileValidationError("Файл пуст.");
  if (input.buffer.length > MAX_DOCUMENT_SIZE_BYTES) throw new DocumentFileValidationError("Размер файла не должен превышать 15 МБ.");
  const rawExtension = extname(filename).slice(1).toLowerCase();
  const allowed = allowedFiles[rawExtension];
  if (!allowed) throw new DocumentFileValidationError("Разрешены PDF, JPG, PNG, WebP, DOCX и XLSX.");
  if (input.declaredMimeType !== allowed.mimeType) throw new DocumentFileValidationError("Тип файла не совпадает с его расширением.");
  if (!hasValidSignature(input.buffer, allowed.extension)) throw new DocumentFileValidationError("Содержимое файла не соответствует заявленному типу.");
  return {
    filename,
    extension: allowed.extension,
    mimeType: allowed.mimeType,
    sizeBytes: input.buffer.length,
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
  };
}
