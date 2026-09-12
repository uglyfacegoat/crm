import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentFolderSchema,
  createDocumentVersionSchema,
  documentBatchExportSchema,
  moveArchiveItemsSchema,
} from "./schemas.ts";

const validInput = {
  idempotencyKey: "8f028fbd-4937-4598-85ce-3a0d972d5f07",
  documentId: "5b5ab8ec-8e07-4bc8-8f83-d2a383bd9d51",
  expectedVersion: 2,
  changeNote: "Исправлена дата выполнения работ",
};

test("document version upload requires optimistic version and accepts an audit note", () => {
  assert.equal(createDocumentVersionSchema.safeParse(validInput).success, true);
  assert.equal(
    createDocumentVersionSchema.safeParse({ ...validInput, expectedVersion: 0 })
      .success,
    false,
  );
  assert.equal(
    createDocumentVersionSchema.safeParse({ ...validInput, changeNote: "x" })
      .success,
    false,
  );
});

test("document version change note may be intentionally omitted", () => {
  const parsed = createDocumentVersionSchema.parse({
    ...validInput,
    changeNote: "",
  });
  assert.equal(parsed.changeNote, null);
});

test("batch export accepts unique document identifiers within the hard limit", () => {
  const identifiers = Array.from(
    { length: 30 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  assert.equal(
    documentBatchExportSchema.safeParse({ documentIds: identifiers }).success,
    true,
  );
  assert.equal(
    documentBatchExportSchema.safeParse({
      documentIds: [...identifiers, "00000000-0000-4000-8000-000000000030"],
    }).success,
    false,
  );
  assert.equal(
    documentBatchExportSchema.safeParse({
      documentIds: [identifiers[0], identifiers[0]],
    }).success,
    false,
  );
  assert.equal(
    documentBatchExportSchema.safeParse({ documentIds: [] }).success,
    false,
  );
});

test("archive folders accept root and nested locations", () => {
  assert.deepEqual(
    createDocumentFolderSchema.parse({
      parentFolderId: "",
      name: " Договоры ",
    }),
    { parentFolderId: null, name: "Договоры" },
  );
  assert.equal(
    createDocumentFolderSchema.safeParse({
      parentFolderId: validInput.documentId,
      name: "2026",
    }).success,
    true,
  );
});

test("archive batch move requires unique selected items and a valid destination", () => {
  const secondId = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(
    moveArchiveItemsSchema.parse({
      folderIds: [validInput.documentId],
      documentIds: [secondId],
      targetFolderId: "",
    }).targetFolderId,
    null,
  );
  assert.equal(
    moveArchiveItemsSchema.safeParse({
      folderIds: [],
      documentIds: [],
      targetFolderId: "",
    }).success,
    false,
  );
  assert.equal(
    moveArchiveItemsSchema.safeParse({
      folderIds: [validInput.documentId, validInput.documentId],
      documentIds: [],
      targetFolderId: secondId,
    }).success,
    false,
  );
});
