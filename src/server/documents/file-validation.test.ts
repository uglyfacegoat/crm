import assert from "node:assert/strict";
import test from "node:test";
import { DocumentFileValidationError, MAX_DOCUMENT_SIZE_BYTES, assertDocumentFileSize, validateDocumentFile } from "./file-validation.ts";

test("accepts a PDF whose extension, MIME type and signature agree", () => {
  const buffer = Buffer.from("%PDF-1.7\nminimal", "ascii");
  const result = validateDocumentFile({ filename: "акт.pdf", declaredMimeType: "application/pdf", buffer });
  assert.equal(result.extension, "pdf");
  assert.equal(result.sizeBytes, buffer.length);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test("normalizes jpeg to the canonical jpg extension", () => {
  const result = validateDocumentFile({ filename: "photo.jpeg", declaredMimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb]) });
  assert.equal(result.extension, "jpg");
});

test("rejects a file with a forged extension", () => {
  assert.throws(
    () => validateDocumentFile({ filename: "contract.pdf", declaredMimeType: "application/pdf", buffer: Buffer.from("not a pdf") }),
    DocumentFileValidationError,
  );
});

test("rejects mismatched MIME, executable names and a forged Office container", () => {
  const pdf = Buffer.from("%PDF-1.7\nminimal", "ascii");
  assert.throws(
    () => validateDocumentFile({ filename: "report.pdf", declaredMimeType: "image/png", buffer: pdf }),
    /Тип файла не совпадает/,
  );
  assert.throws(
    () => validateDocumentFile({ filename: "report.exe", declaredMimeType: "application/pdf", buffer: pdf }),
    /Разрешены PDF/,
  );
  assert.throws(
    () => validateDocumentFile({ filename: "report.docx", declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("not a zip with word/ and [Content_Types].xml") }),
    /Содержимое файла не соответствует/,
  );
});

test("strips path fragments from the display name without using them as a storage key", () => {
  const file = validateDocumentFile({ filename: "../../documents/акт.pdf", declaredMimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nminimal", "ascii") });
  assert.equal(file.filename, "акт.pdf");
  assert.equal(file.extension, "pdf");
});

test("rejects a file larger than the configured limit", () => {
  assert.doesNotThrow(() => assertDocumentFileSize(MAX_DOCUMENT_SIZE_BYTES));
  assert.throws(() => assertDocumentFileSize(MAX_DOCUMENT_SIZE_BYTES + 1), /15 МБ/);
  assert.throws(
    () => validateDocumentFile({ filename: "large.pdf", declaredMimeType: "application/pdf", buffer: Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES + 1) }),
    /15 МБ/,
  );
});
