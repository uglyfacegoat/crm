import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDocumentArchivePath, createDocumentExportArchive, DocumentExportIntegrityError, safeArchiveSegment } from "./export-archive.ts";
import type { DocumentExportFile } from "./types.ts";

function exportFile(overrides: Partial<DocumentExportFile> = {}): DocumentExportFile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    documentId: "22222222-2222-4222-8222-222222222222",
    filename: "акт.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
    sha256: createHash("sha256").update("test").digest("hex"),
    storageKey: "organization/document/v1.pdf",
    clientId: "33333333-3333-4333-8333-333333333333",
    clientName: "ООО Клиент",
    objectId: "44444444-4444-4444-8444-444444444444",
    objectName: "Склад",
    orderNumber: "1248",
    category: "act",
    ...overrides,
  };
}

test("archive segments remove paths, control characters and reserved Windows names", () => {
  assert.equal(safeArchiveSegment("../Договор\\финал?.pdf", "document"), "Договор финал .pdf");
  assert.equal(safeArchiveSegment("CON", "document"), "_CON");
  assert.equal(safeArchiveSegment("...", "document"), "document");
});

test("archive paths are hierarchical and remain unique for equal filenames", () => {
  const occupied = new Set<string>();
  const first = createDocumentArchivePath(exportFile(), occupied);
  const second = createDocumentArchivePath(exportFile({ documentId: "55555555-5555-4555-8555-555555555555" }), occupied);
  assert.match(first, /^ООО Клиент \[33333333\]\/Склад \[44444444\]\/Заказ 1248\/Акты\/акт\.pdf$/);
  assert.match(second, /акт \(2\)\.pdf$/);
});

test("ZIP export verifies integrity before creating an archive", () => {
  const valid = exportFile();
  const result = createDocumentExportArchive([{ ...valid, content: Buffer.from("test") }]);
  assert.equal(result.totalSizeBytes, 4);
  assert.deepEqual([...result.archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.throws(
    () => createDocumentExportArchive([{ ...valid, content: Buffer.from("tampered") }]),
    DocumentExportIntegrityError,
  );
});
