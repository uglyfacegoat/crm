import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { validateStorageKey } from "../src/server/storage/file-integrity.mjs";

test("file storage accepts generated tenant/version keys and rejects user paths", () => {
  const organizationId = randomUUID();
  const fileId = randomUUID();
  assert.doesNotThrow(() => validateStorageKey(`${organizationId}/${fileId}/v1.pdf`));
  assert.doesNotThrow(() => validateStorageKey(`${organizationId}/${fileId}/v2.jpg`));
  for (const key of [
    `../${fileId}/v1.pdf`,
    `${organizationId}/${fileId}/../../v1.pdf`,
    `${organizationId}/${fileId}/v1.exe`,
    `${organizationId}/${fileId}/v0.pdf`,
    `${organizationId}/${fileId}/v1.pdf/another`,
  ]) assert.throws(() => validateStorageKey(key), /Invalid document storage key/);
});
