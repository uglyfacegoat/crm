import assert from "node:assert/strict";
import test from "node:test";
import { parseS3Config, storageBackend } from "../src/server/storage/s3-config.mjs";
import { validateRuntimeEnvironment } from "../src/server/config/environment.ts";

const valid = {
  DOCUMENT_STORAGE_BACKEND: "s3", DOCUMENT_S3_ENDPOINT: "https://s3.example.invalid",
  DOCUMENT_S3_REGION: "us-east-1", DOCUMENT_S3_BUCKET: "crm-private",
  DOCUMENT_S3_ACCESS_KEY_ID: "test-only-access", DOCUMENT_S3_SECRET_ACCESS_KEY: "test-only-secret",
};

test("S3 configuration requires explicit credentials and private HTTPS endpoint configuration", () => {
  assert.equal(storageBackend({}), "local");
  assert.equal(storageBackend(valid), "s3");
  assert.throws(() => storageBackend({ DOCUMENT_STORAGE_BACKEND: "s-3" }), /DOCUMENT_STORAGE_BACKEND/);
  const parsed = parseS3Config(valid);
  assert.equal(parsed.endpoint, valid.DOCUMENT_S3_ENDPOINT);
  assert.equal(parsed.timeoutMs, 30000);
  assert.equal(parsed.forcePathStyle, false);
  for (const field of ["DOCUMENT_S3_ENDPOINT", "DOCUMENT_S3_REGION", "DOCUMENT_S3_BUCKET", "DOCUMENT_S3_ACCESS_KEY_ID", "DOCUMENT_S3_SECRET_ACCESS_KEY"]) {
    assert.throws(() => parseS3Config({ ...valid, [field]: undefined }), new RegExp(field));
  }
});

test("S3 startup rejects unsafe values without disclosing credentials", () => {
  for (const [field, value] of [
    ["DOCUMENT_S3_ENDPOINT", "http://s3.example.invalid"],
    ["DOCUMENT_S3_ENDPOINT", "https://access:secret@s3.example.invalid"],
    ["DOCUMENT_S3_ENDPOINT", "https://s3.example.invalid/private?secret=value"],
    ["DOCUMENT_S3_BUCKET", "../other-bucket"], ["DOCUMENT_S3_BUCKET", "127.0.0.1"],
    ["DOCUMENT_S3_SECRET_ACCESS_KEY", " padded-secret "],
    ["DOCUMENT_S3_FORCE_PATH_STYLE", "yes"], ["DOCUMENT_S3_ALLOW_LOCAL_HTTP", "yes"],
    ["DOCUMENT_S3_TIMEOUT_MS", "0"], ["DOCUMENT_S3_TIMEOUT_MS", "120001"],
  ]) {
    assert.throws(() => parseS3Config({ ...valid, [field]: value }), (error) => {
      assert.match(error.message, new RegExp(field));
      assert.ok(!error.message.includes(value));
      return true;
    });
  }
  assert.throws(() => parseS3Config({ ...valid, DOCUMENT_S3_ENDPOINT: "http://s3.example.invalid", DOCUMENT_S3_ALLOW_LOCAL_HTTP: "true" }), /DOCUMENT_S3_ENDPOINT/);
  assert.doesNotThrow(() => parseS3Config({ ...valid, DOCUMENT_S3_ENDPOINT: "http://127.0.0.1:9000", DOCUMENT_S3_ALLOW_LOCAL_HTTP: "true" }));
  assert.doesNotThrow(() => validateRuntimeEnvironment({ ...valid, NODE_ENV: "production", AUTH_MODE: "preview" }));
  assert.throws(() => validateRuntimeEnvironment({ ...valid, AUTH_MODE: "preview", DOCUMENT_S3_BUCKET: undefined }), /DOCUMENT_S3_BUCKET/);
});
