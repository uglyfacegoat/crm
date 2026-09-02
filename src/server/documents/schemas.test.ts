import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentVersionSchema, documentBatchExportSchema } from "./schemas.ts";

const validInput = {
  idempotencyKey: "8f028fbd-4937-4598-85ce-3a0d972d5f07",
  documentId: "5b5ab8ec-8e07-4bc8-8f83-d2a383bd9d51",
  expectedVersion: 2,
  changeNote: "Исправлена дата выполнения работ",
};

test("document version upload requires optimistic version and accepts an audit note", () => {
  assert.equal(createDocumentVersionSchema.safeParse(validInput).success, true);
  assert.equal(createDocumentVersionSchema.safeParse({ ...validInput, expectedVersion: 0 }).success, false);
  assert.equal(createDocumentVersionSchema.safeParse({ ...validInput, changeNote: "x" }).success, false);
});

test("document version change note may be intentionally omitted", () => {
  const parsed = createDocumentVersionSchema.parse({ ...validInput, changeNote: "" });
  assert.equal(parsed.changeNote, null);
});

test("batch export accepts unique document identifiers within the hard limit", () => {
  const identifiers = Array.from({ length: 30 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  assert.equal(documentBatchExportSchema.safeParse({ documentIds: identifiers }).success, true);
  assert.equal(documentBatchExportSchema.safeParse({ documentIds: [...identifiers, "00000000-0000-4000-8000-000000000030"] }).success, false);
  assert.equal(documentBatchExportSchema.safeParse({ documentIds: [identifiers[0], identifiers[0]] }).success, false);
  assert.equal(documentBatchExportSchema.safeParse({ documentIds: [] }).success, false);
});
