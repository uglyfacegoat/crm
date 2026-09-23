import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const sourceRoot = new URL("../src/", import.meta.url);
const documentsUrl = new URL("app/(workspace)/documents/actions.ts", sourceRoot);
const financeUrl = new URL("app/(workspace)/finance/actions.ts", sourceRoot);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if ([documentsUrl.href, financeUrl.href].includes(context.parentURL)) {
      if (specifier === "next/cache") return nextResolve("next/cache.js", context);
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const documentFunctions = Object.fromEntries([
  "createDocument", "createDocumentFolder", "createDocumentVersion", "documentVersionUploadExists",
  "documentUploadExists", "getDocumentVersionUploadTarget", "moveArchiveItems", "setDocumentFavorite",
].map((name) => [name, mock.fn()]));
const documentErrors = Object.fromEntries([
  "DocumentFolderConflictError", "DocumentFolderCycleError", "DocumentFolderNotFoundError", "DocumentNotFoundError",
  "DocumentReferenceError", "DocumentVersionConflictError", "DocumentVersionDuplicateContentError", "DocumentVersionRequestConflictError",
].map((name) => [name, class extends Error {}]));
const financeFunctions = Object.fromEntries([
  "createInvoice", "createMasterPayout", "createPayment", "financeMutationExists", "reverseMasterPayout", "reversePayment", "voidInvoice",
].map((name) => [name, mock.fn()]));
const financeErrors = Object.fromEntries([
  "FinanceAmountExceedsBalanceError", "FinanceEntryConflictError", "FinanceEntryNotFoundError", "FinanceFutureDateError",
  "FinanceInvoiceHasPaymentsError", "FinanceInvoiceNumberConflictError", "FinanceReferenceError", "FinanceRequestConflictError",
].map((name) => [name, class extends Error {}]));
const revalidatePath = mock.fn();
const writeDocumentFile = mock.fn();
const removeDocumentFile = mock.fn();
const FileWritesPausedError = class extends Error {};
const FileWriteLeaseLostError = class extends Error {};
const withFileWriteLease = mock.fn(async (operation) => operation());
mock.module("next/cache.js", { namedExports: { revalidatePath } });
mock.module(new URL("server/auth/config.ts", sourceRoot), { namedExports: { getAuthMode: () => "required" } });
mock.module(new URL("server/auth/session.ts", sourceRoot), { namedExports: { requireSession: async () => ({ organizationId: "test-organization", memberId: "test-member" }) } });
mock.module(new URL("server/file-writes/gate.mjs", sourceRoot), { namedExports: {
  FileWriteLeaseLostError, FileWritesPausedError, withFileWriteLease,
} });
mock.module(new URL("server/documents/repository.ts", sourceRoot), { namedExports: { ...documentFunctions, ...documentErrors } });
mock.module(new URL("server/finance/repository.ts", sourceRoot), { namedExports: { ...financeFunctions, ...financeErrors } });
mock.module(new URL("server/documents/storage.ts", sourceRoot), { namedExports: {
  writeDocumentFile, removeDocumentFile,
  createDocumentStorageKey: () => "receipt.pdf",
  createDocumentVersionStorageKey: () => "receipt.pdf",
} });
const { uploadDocumentAction, uploadDocumentVersionAction } = await import(documentsUrl.href);
const { createPaymentAction, createPayoutAction } = await import(financeUrl.href);
const previous = { status: "idle", message: null, fieldErrors: {} };
const content = Buffer.from("%PDF-1.4\nRetained evidence\n");

function form() {
  const result = new FormData();
  for (const field of ["idempotencyKey", "orderId", "invoiceId", "receiptDocumentId", "documentId"]) {
    result.set(field, "d81478c4-9807-44b4-befb-5819bbfbad22");
  }
  for (const [field, value] of Object.entries({
    category: "other", title: "Stored evidence", description: "", expectedVersion: "1", changeNote: "Updated evidence",
    amount: "100", receivedOn: "2026-09-20", paidOn: "2026-09-20", paymentMethod: "cash", reference: "", note: "",
  })) result.set(field, value);
  for (const field of ["receipt", "file"]) result.set(field, new File([content], "receipt.pdf", { type: "application/pdf" }));
  return result;
}

test("file mutations distinguish persistence from post-commit cache failures", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "crm-upload-commit-"));
  const path = join(directory, "receipt.pdf");
  const log = mock.method(console, "error", () => {});
  t.after(async () => { await rm(directory, { recursive: true, force: true }); mock.restoreAll(); hooks.deregister(); });
  t.beforeEach(async () => {
    await rm(path, { force: true });
    for (const fn of [...Object.values(documentFunctions), ...Object.values(financeFunctions), revalidatePath, writeDocumentFile, removeDocumentFile, withFileWriteLease, log]) {
      fn.mock.resetCalls();
      fn.mock.mockImplementation(async () => undefined);
    }
    revalidatePath.mock.mockImplementation(() => undefined);
    log.mock.mockImplementation(() => {});
    withFileWriteLease.mock.mockImplementation(async (operation) => operation());
    documentFunctions.documentUploadExists.mock.mockImplementation(async () => false);
    documentFunctions.documentVersionUploadExists.mock.mockImplementation(async () => false);
    financeFunctions.financeMutationExists.mock.mockImplementation(async () => false);
    financeFunctions.createPayment.mock.mockImplementation(async () => ({ id: "test-payment", created: true }));
    financeFunctions.createMasterPayout.mock.mockImplementation(async () => ({ id: "test-payout", created: true }));
    documentFunctions.getDocumentVersionUploadTarget.mock.mockImplementation(async () => ({ documentId: "test-document", orderId: "test-order", versionNumber: 2 }));
    writeDocumentFile.mock.mockImplementation(async (_key, bytes) => writeFile(path, bytes, { flag: "wx" }));
    removeDocumentFile.mock.mockImplementation(async () => unlink(path));
  });
  for (const [name, action, persist, rollbackError] of [
    ["document", uploadDocumentAction, documentFunctions.createDocument, new documentErrors.DocumentReferenceError()],
    ["document version", uploadDocumentVersionAction, documentFunctions.createDocumentVersion, new documentErrors.DocumentVersionConflictError()],
    ["payment", createPaymentAction, financeFunctions.createPayment, new financeErrors.FinanceReferenceError()],
    ["payout", createPayoutAction, financeFunctions.createMasterPayout, new financeErrors.FinanceReferenceError()],
  ]) {
    await t.test(`${name}: normal success retains the complete file`, async () => {
      const result = await action(previous, form());
      assert.equal(result.status, "success", result.message);
      assert.equal(result.refreshRequired, undefined);
      assert.equal(persist.mock.callCount(), 1);
      assert.deepEqual(await readFile(path), content);
      assert.equal(removeDocumentFile.mock.callCount(), 0);
    });
    for (const failAt of [1, 2]) {
      await t.test(`${name}: revalidation failure ${failAt} never deletes committed bytes`, async () => {
        let refreshCount = 0;
        revalidatePath.mock.mockImplementation(() => { if (++refreshCount === failAt) throw new Error("Injected post-commit cache failure"); });
        const result = await action(previous, form());
        assert.equal(result.status, "success", result.message);
        assert.equal(result.refreshRequired, true);
        assert.match(result.message, /сохранена|сохранён|проведена/);
        assert.match(result.message, /вручную/);
        assert.equal(persist.mock.callCount(), 1);
        assert.deepEqual(await readFile(path), content);
        assert.equal(removeDocumentFile.mock.callCount(), 0);
        assert.equal(log.mock.callCount(), 1);
        assert.match(JSON.parse(log.mock.calls[0].arguments[0]).operation, /revalidate/);
      });
    }
    await t.test(`${name}: rejected transaction removes its newly created file`, async () => {
      persist.mock.mockImplementation(async () => { throw rollbackError; });
      const result = await action(previous, form());
      assert.equal(result.status, "error");
      assert.equal(result.refreshRequired, undefined);
      assert.equal(revalidatePath.mock.callCount(), 0);
      assert.equal(removeDocumentFile.mock.callCount(), 1);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    });
    await t.test(`${name}: unknown transaction outcome retains evidence without claiming success or rollback`, async () => {
      persist.mock.mockImplementation(async () => { throw new Error("Connection lost while receiving COMMIT response"); });
      const result = await action(previous, form());
      assert.equal(result.status, "error");
      assert.match(result.message, /Не удалось подтвердить/);
      assert.equal(revalidatePath.mock.callCount(), 0);
      assert.equal(removeDocumentFile.mock.callCount(), 0);
      assert.deepEqual(await readFile(path), content);
      assert.equal(log.mock.callCount(), 1);
    });
    await t.test(`${name}: another request's existing file is never removed`, async () => {
      await writeFile(path, content);
      persist.mock.mockImplementation(async () => { throw rollbackError; });
      assert.equal((await action(previous, form())).status, "error");
      assert.equal(removeDocumentFile.mock.callCount(), 0);
      assert.deepEqual(await readFile(path), content);
    });
  }
  for (const [name, action, persist] of [
    ["payment", createPaymentAction, financeFunctions.createPayment],
    ["payout", createPayoutAction, financeFunctions.createMasterPayout],
  ]) {
    await t.test(`${name}: confirmed retries do not read or write receipt bytes`, async () => {
      financeFunctions.financeMutationExists.mock.mockImplementation(async () => true);
      const payload = form();
      const read = mock.method(payload.get("receipt"), "arrayBuffer", () => { throw new Error("A confirmed retry must not read the file"); });
      assert.equal((await action(previous, payload)).status, "success");
      assert.equal(read.mock.callCount(), 0);
      assert.equal(writeDocumentFile.mock.callCount(), 0);
      assert.equal(persist.mock.callCount(), 0);
      assert.equal(removeDocumentFile.mock.callCount(), 0);
    });
    for (const [failure, error] of [["permission", new AuthorizationError()], ["request conflict", new financeErrors.FinanceRequestConflictError()]]) {
      await t.test(`${name}: ${failure} preflight failure precedes file I/O`, async () => {
        financeFunctions.financeMutationExists.mock.mockImplementation(async () => { throw error; });
        assert.equal((await action(previous, form())).status, "error");
        assert.equal(writeDocumentFile.mock.callCount(), 0);
        assert.equal(persist.mock.callCount(), 0);
        assert.equal(removeDocumentFile.mock.callCount(), 0);
      });
    }
    await t.test(`${name}: a transaction that loses the request-key race removes only its unused new receipt`, async () => {
      persist.mock.mockImplementation(async () => ({ id: "existing-entry", created: false }));
      assert.equal((await action(previous, form())).status, "success");
      assert.equal(removeDocumentFile.mock.callCount(), 1);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    });
    for (const [description, existing] of [["matching", content], ["different", Buffer.from("%PDF-1.4\nDifferent evidence\n")]]) {
      await t.test(`${name}: existing unconfirmed ${description} bytes are neither reused nor deleted`, async () => {
        await writeFile(path, existing);
        const result = await action(previous, form());
        assert.equal(result.status, "error");
        assert.match(result.fieldErrors.receipt[0], /уже существует/);
        assert.equal(persist.mock.callCount(), 0);
        assert.equal(removeDocumentFile.mock.callCount(), 0);
        assert.deepEqual(await readFile(path), existing);
      });
    }
    await t.test(`${name}: a concurrent retry cannot commit a file that its owner rolls back`, async () => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      persist.mock.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        throw new financeErrors.FinanceReferenceError();
      });
      const owner = action(previous, form());
      await entered.promise;
      try {
        assert.equal((await action(previous, form())).status, "error");
        assert.equal(persist.mock.callCount(), 1);
        assert.deepEqual(await readFile(path), content);
      } finally { release.resolve(); }
      assert.equal((await owner).status, "error");
      assert.equal(removeDocumentFile.mock.callCount(), 1);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    });
  }
  for (const [name, action] of [
    ["document", uploadDocumentAction], ["document version", uploadDocumentVersionAction],
    ["payment receipt", createPaymentAction], ["payout receipt", createPayoutAction],
  ]) {
    await t.test(`${name}: paused file writes reject before touching storage`, async () => {
      withFileWriteLease.mock.mockImplementation(async () => { throw new FileWritesPausedError(); });
      const result = await action(previous, form());
      assert.equal(result.status, "error");
      assert.match(result.message, /временно остановлена/);
      assert.equal(writeDocumentFile.mock.callCount(), 0);
    });
  }
});
