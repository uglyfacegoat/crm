import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";
import { StoredFileIntegrityError } from "../src/server/storage/file-integrity.mjs";
import { startS3Fixture } from "./fixtures/s3-server.mjs";

test("S3 preserves exclusive writes, private access and bounded verified reads", async (t) => {
  const fixture = await startS3Fixture();
  const store = createS3Storage(fixture.environment);
  t.after(async () => { store.close(); await fixture.close(); });
  const key = () => `${randomUUID()}/${randomUUID()}/v1.pdf`;
  const bytes = Buffer.from("private S3 document bytes");
  const expected = { sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const storedKey = key();
  await t.test("bucket readiness uses authenticated access without writing an object", async () => {
    await store.checkAvailability();
  });
  await t.test("round trip is private and byte-exact", async () => {
    await store.write(storedKey, bytes);
    assert.deepEqual(await store.readVerified(storedKey, expected, 1024), bytes);
    assert.equal((await fetch(`${fixture.endpoint}/${fixture.bucket}/${storedKey}`)).status, 403);
    assert.equal((await fetch(`${fixture.endpoint}/${fixture.bucket}?list-type=2`)).status, 403);
  });
  await t.test("existing keys are never overwritten, including concurrent writers", async () => {
    await assert.rejects(store.write(storedKey, Buffer.from("replacement")), { code: "EEXIST" });
    assert.deepEqual(await store.readVerified(storedKey, expected, 1024), bytes);
    const raceKey = key();
    const outcomes = await Promise.allSettled([store.write(raceKey, bytes), store.write(raceKey, Buffer.from("other writer"))]);
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.find(outcome => outcome.status === "rejected").reason.code, "EEXIST");
    const response = await fixture.client.send(new GetObjectCommand({ Bucket: fixture.bucket, Key: raceKey }));
    const actual = Buffer.from(await response.Body.transformToByteArray());
    assert.ok(actual.equals(bytes) || actual.equals(Buffer.from("other writer")));
  });
  await t.test("invalid expectations, size mismatches and corruption fail closed", async () => {
    for (const patch of [{ sizeBytes: 0 }, { sizeBytes: 1025 }, { sizeBytes: bytes.length + 1 }, { sha256: "bad" }, { sha256: "0".repeat(64) }]) {
      await assert.rejects(store.readVerified(storedKey, { ...expected, ...patch }, 1024), StoredFileIntegrityError);
    }
    const corruptKey = key();
    await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: corruptKey, Body: Buffer.alloc(bytes.length, "x") }));
    await assert.rejects(store.readVerified(corruptKey, expected, 1024), StoredFileIntegrityError);
  });
  await t.test("missing object and invalid credentials are explicit errors, never a local fallback", async () => {
    await assert.rejects(store.readVerified(key(), expected, 1024), { code: "ENOENT" });
    const unauthorized = createS3Storage({ ...fixture.environment, DOCUMENT_S3_SECRET_ACCESS_KEY: "invalid-secret-for-fixture" });
    try {
      await assert.rejects(unauthorized.checkAvailability(), { code: "EACCES" });
      await assert.rejects(unauthorized.readVerified(storedKey, expected, 1024), (error) => {
        assert.equal(error.code, "EACCES");
        assert.doesNotMatch(error.message, /invalid-secret|127\.0\.0\.1|private S3/);
        return true;
      });
    } finally { unauthorized.close(); }
  });
  await t.test("unsafe keys and invalid write sizes are rejected", async () => {
    for (const bad of ["../../private.pdf", "/absolute.pdf", `${randomUUID()}/${randomUUID()}/v0.pdf`]) {
      await assert.rejects(store.write(bad, bytes), /Invalid document storage key/);
      await assert.rejects(store.remove(bad), /Invalid document storage key/);
      await assert.rejects(store.readVerified(bad, expected, 1024), /Invalid document storage key/);
    }
    await assert.rejects(store.write(key(), Buffer.alloc(0)), RangeError);
    await assert.rejects(store.write(key(), Buffer.alloc(15 * 1024 * 1024 + 1)), RangeError);
  });
  await t.test("remove is idempotent and does not affect other objects", async () => {
    const removed = key();
    await store.write(removed, bytes);
    await store.remove(removed);
    await store.remove(removed);
    await assert.rejects(store.readVerified(removed, expected, 1024), { code: "ENOENT" });
    assert.deepEqual(await store.readVerified(storedKey, expected, 1024), bytes);
  });
  await t.test("a stalled body is terminated within the configured timeout", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": bytes.length });
      response.write(bytes.subarray(0, 1));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const stalled = createS3Storage({ ...fixture.environment, DOCUMENT_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`, DOCUMENT_S3_TIMEOUT_MS: "1000" });
    try {
      const started = performance.now();
      await assert.rejects(stalled.readVerified(storedKey, expected, 1024), { code: "ETIMEDOUT" });
      assert.ok(performance.now() - started < 3000);
    } finally {
      stalled.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  await t.test("a truncated response never returns an empty or partial document", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": bytes.length });
      response.write(bytes.subarray(0, 1), () => response.socket.end());
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const partial = createS3Storage({ ...fixture.environment, DOCUMENT_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}` });
    try {
      await assert.rejects(partial.readVerified(storedKey, expected, 1024), { code: "ESTORAGE" });
    } finally {
      partial.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
  await t.test("an unavailable endpoint fails explicitly without a local fallback", async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    await new Promise(resolve => server.close(resolve));
    const offline = createS3Storage({ ...fixture.environment, DOCUMENT_S3_ENDPOINT: endpoint, DOCUMENT_S3_TIMEOUT_MS: "1000" });
    try {
      await assert.rejects(offline.checkAvailability(), { code: "ESTORAGE" });
      await assert.rejects(offline.readVerified(storedKey, expected, 1024), { code: "ESTORAGE" });
    } finally { offline.close(); }
  });
  await t.test("an unacknowledged write is not retried or cleaned up automatically", async () => {
    const operations = [];
    const server = createServer(async (request) => {
      operations.push(request.method);
      for await (const chunk of request) assert.ok(chunk.length > 0);
      request.socket.destroy();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const uncertain = createS3Storage({ ...fixture.environment, DOCUMENT_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}` });
    try {
      await assert.rejects(uncertain.write(key(), bytes), { code: "ESTORAGE" });
      assert.deepEqual(operations, ["PUT"]);
    } finally {
      uncertain.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
