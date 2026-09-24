import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
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

test("accepts structurally readable Office ZIP files", () => {
  for (const [extension, part, mimeType] of [
    ["docx", "word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xlsx", "xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const) {
    const buffer = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), [part]: Buffer.from("<document/>") }));
    assert.equal(validateDocumentFile({ filename: `sample.${extension}`, declaredMimeType: mimeType, buffer }).extension, extension);
  }
});

test("rejects malformed Office ZIPs and archives with excessive expanded size", () => {
  const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const validate = (buffer: Buffer) => validateDocumentFile({ filename: "sample.docx", declaredMimeType: mimeType, buffer });
  assert.throws(() => validate(Buffer.from("PK\x03\x04[Content_Types].xml word/document.xml", "latin1")), DocumentFileValidationError);
  const valid = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/document.xml": Buffer.from("<document/>") }));
  assert.throws(() => validate(valid.subarray(0, valid.length - 20)), DocumentFileValidationError);
  const forgedSize = Buffer.from(valid);
  const centralDirectory = forgedSize.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralDirectory >= 0);
  forgedSize.writeUInt32LE(1, centralDirectory + 24);
  assert.throws(() => validate(forgedSize), DocumentFileValidationError);
  const bomb = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/document.xml": Buffer.alloc(26 * 1024 * 1024, 65) }));
  assert.ok(bomb.length < 100_000);
  assert.throws(() => validate(bomb), DocumentFileValidationError);
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
