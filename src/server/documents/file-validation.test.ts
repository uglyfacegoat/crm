import assert from "node:assert/strict";
import test from "node:test";
import { DocumentFileValidationError, MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "./file-validation.ts";

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

test("rejects a file larger than the configured limit", () => {
  assert.throws(
    () => validateDocumentFile({ filename: "large.pdf", declaredMimeType: "application/pdf", buffer: Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES + 1) }),
    /15 МБ/,
  );
});
