import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";

const bucket = "crm-inventory-test";
const version = (key, id = "null", extra = "") => `<Version><Key>${key}</Key><VersionId>${id}</VersionId><IsLatest>true</IsLatest><LastModified>2026-09-20T00:00:00Z</LastModified><Size>3</Size>${extra}</Version>`;
const listing = (entries = "", pagination = "<IsTruncated>false</IsTruncated>") => `<ListVersionsResult><Name>${bucket}</Name><EncodingType>url</EncodingType>${pagination}${entries}</ListVersionsResult>`;

async function inventoryServer(t, reply) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: new URL(request.url, "http://localhost") });
    const result = reply(requests.at(-1), requests.length);
    if (result === null) return;
    response.writeHead(result.status ?? 200, { "content-type": "application/xml" });
    response.end(result.body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const storage = createS3AuditStorage({
    DOCUMENT_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`, DOCUMENT_S3_ALLOW_LOCAL_HTTP: "true",
    DOCUMENT_S3_REGION: "us-east-1", DOCUMENT_S3_BUCKET: bucket, DOCUMENT_S3_FORCE_PATH_STYLE: "true",
    DOCUMENT_S3_ACCESS_KEY_ID: randomBytes(16).toString("hex"), DOCUMENT_S3_SECRET_ACCESS_KEY: randomBytes(32).toString("hex"),
    DOCUMENT_S3_TIMEOUT_MS: "1000",
  });
  t.after(async () => {
    storage.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { storage, requests };
}

async function collect(storage) {
  const entries = [];
  for await (const entry of storage.inventory()) entries.push(entry);
  return entries;
}

test("S3 inventory decodes keys once and sends both continuation markers, including versions of the same key", async t => {
  const encoded = "a+space%20and%2Bplus%252Fkey";
  const decoded = "a space and+plus%2Fkey";
  const { storage, requests } = await inventoryServer(t, (_request, count) => {
    const pagination = count < 3
      ? `<IsTruncated>true</IsTruncated><NextKeyMarker>${encoded}</NextKeyMarker><NextVersionIdMarker>version-${count}</NextVersionIdMarker>`
      : "<IsTruncated>false</IsTruncated>";
    return { body: listing(version(encoded, `version-${count}`), pagination) };
  });
  assert.equal((await collect(storage)).length, 3);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.method === "GET" && request.url.searchParams.get("max-keys") === "100"));
  for (const [index, request] of requests.slice(1).entries()) {
    assert.equal(request.url.searchParams.get("key-marker"), decoded);
    assert.equal(request.url.searchParams.get("version-id-marker"), `version-${index + 1}`);
  }
});

for (const [name, body] of [
  ["missing completion flag", listing("", "")],
  ["wrong bucket", listing().replace(bucket, "different-bucket")],
  ["missing encoding contract", listing().replace("<EncodingType>url</EncodingType>", "")],
  ["rolled-up directories", listing("<CommonPrefixes><Prefix>hidden/</Prefix></CommonPrefixes>")],
  ["missing next markers", listing(version("key"), "<IsTruncated>true</IsTruncated>")],
  ["missing version identifier", listing(version("key").replace("<VersionId>null</VersionId>", ""))],
  ["negative size", listing(version("key").replace("<Size>3</Size>", "<Size>-1</Size>"))],
  ["invalid timestamp", listing(version("key").replace("2026-09-20T00:00:00Z", "invalid"))],
  ["malformed percent encoding", listing(version("key%ZZ"))],
]) {
  test(`S3 inventory rejects ${name} rather than returning an empty or complete report`, async t => {
    const { storage } = await inventoryServer(t, () => ({ body }));
    await assert.rejects(collect(storage));
  });
}

test("S3 inventory rejects a repeated pagination marker", async t => {
  const body = listing(version("key"), "<IsTruncated>true</IsTruncated><NextKeyMarker>key</NextKeyMarker><NextVersionIdMarker>null</NextVersionIdMarker>");
  const { storage, requests } = await inventoryServer(t, () => ({ body }));
  await assert.rejects(collect(storage), /pagination did not advance/);
  assert.equal(requests.length, 2);
});

test("S3 inventory retains deletion markers and normal versioning states", async t => {
  let status;
  const { storage, requests } = await inventoryServer(t, request => ({ body: request.url.searchParams.has("versioning")
    ? `<VersioningConfiguration>${status ? `<Status>${status}</Status>` : ""}</VersioningConfiguration>`
    : listing("<DeleteMarker><Key>key</Key><VersionId>marker-id</VersionId><IsLatest>true</IsLatest><LastModified>2026-09-20T00:00:00Z</LastModified></DeleteMarker>"),
  }));
  for (status of [undefined, "Enabled", "Suspended"]) assert.equal(await storage.versioning(), status ?? "Disabled");
  status = "unknown";
  await assert.rejects(storage.versioning(), /Invalid bucket versioning/);
  assert.deepEqual(await collect(storage), [{
    storageKey: "key", versionId: "marker-id", isLatest: true, kind: "delete-marker", sizeBytes: 0, modifiedAt: "2026-09-20T00:00:00.000Z",
  }]);
  assert.ok(requests.every(request => request.method === "GET"));
});

test("S3 inventory permission failures are explicit and redact provider messages", async t => {
  const { storage } = await inventoryServer(t, () => ({ status: 403, body: "<Error><Code>AccessDenied</Code><Message>private-provider-detail</Message></Error>" }));
  for (const operation of [() => storage.versioning(), () => collect(storage)]) {
    await assert.rejects(operation(), error => {
      assert.equal(error.code, "EACCES");
      assert.doesNotMatch(error.message, /private-provider-detail|127\.0\.0\.1/);
      return true;
    });
  }
});

test("S3 inventory aborts a stalled request within its deadline", async t => {
  const { storage } = await inventoryServer(t, () => null);
  const started = performance.now();
  await assert.rejects(collect(storage), { code: "ETIMEDOUT" });
  assert.ok(performance.now() - started < 3000);
});
