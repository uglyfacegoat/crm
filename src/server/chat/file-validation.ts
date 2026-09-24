import { createHash } from "node:crypto";
import { extname } from "node:path";
import { DocumentFileValidationError, MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "../documents/file-validation.ts";

export const MAX_CHAT_ATTACHMENT_BYTES = MAX_DOCUMENT_SIZE_BYTES;
export const MAX_CHAT_AVATAR_BYTES = 3 * 1024 * 1024;

const audioTypes = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
} as const;

function safeName(filename: string) {
  const basename = filename.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!basename || basename.length > 255) throw new DocumentFileValidationError("Имя файла должно содержать от 1 до 255 символов.");
  return basename;
}

function validAudioSignature(buffer: Buffer, extension: keyof typeof audioTypes) {
  if (extension === "webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (extension === "wav") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  if (extension === "mp3") return buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  return buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

export function validateChatAttachment(input: { filename: string; declaredMimeType: string; buffer: Buffer }) {
  const extension = extname(input.filename).slice(1).toLowerCase() as keyof typeof audioTypes;
  if (!(extension in audioTypes)) return validateDocumentFile(input);
  const filename = safeName(input.filename);
  if (!input.buffer.length) throw new DocumentFileValidationError("Файл пуст.");
  if (input.buffer.length > MAX_CHAT_ATTACHMENT_BYTES) throw new DocumentFileValidationError("Размер файла не должен превышать 15 МБ.");
  const mimeType = audioTypes[extension];
  if (input.declaredMimeType !== mimeType || !validAudioSignature(input.buffer, extension)) throw new DocumentFileValidationError("Содержимое аудиофайла не соответствует заявленному типу.");
  return { filename, extension, mimeType, sizeBytes: input.buffer.length, sha256: createHash("sha256").update(input.buffer).digest("hex") };
}

export function validateChatAvatar(input: { filename: string; declaredMimeType: string; buffer: Buffer }) {
  const file = validateDocumentFile(input);
  if (!(["jpg", "png", "webp"] as string[]).includes(file.extension)) throw new DocumentFileValidationError("Для фото группы разрешены JPG, PNG и WebP.");
  if (file.sizeBytes > MAX_CHAT_AVATAR_BYTES) throw new DocumentFileValidationError("Фото группы не должно превышать 3 МБ.");
  return file as typeof file & { extension: "jpg" | "png" | "webp" };
}
