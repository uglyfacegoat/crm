import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const baseUrl = process.env.SMOKE_BASE_URL;
const identity = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const webhookSecret = process.env.CRM_WEBSITE_WEBHOOK_SECRET;
if (!baseUrl || !identity || !password || !webhookSecret) throw new Error("Disposable runtime-check credentials and webhook secret are required.");
const origin = new URL(baseUrl).origin;

const login = await fetch(`${origin}/api/v1/auth/login`, {
  method: "POST", headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ identity, password }), signal: AbortSignal.timeout(15_000),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];

function postChunks(path, chunks, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = (origin.startsWith("https:") ? httpsRequest : httpRequest)(`${origin}${path}`, {
      method: "POST", timeout: 15_000,
      headers: { origin, "content-type": "application/json", ...headers },
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(new Error(`${path} returned a non-JSON response (${response.statusCode})`, { cause: error }));
        }
      });
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.on("timeout", () => outgoing.destroy(new Error("Body check timed out")));
    for (const chunk of chunks) outgoing.write(chunk);
    outgoing.end();
  });
}

try {
  for (const [path, limit, headers, validationStatus] of [
    ["/api/v1/auth/login", 32 * 1024, {}, 422],
    ["/api/v1/documents/export", 16 * 1024, { cookie }, 400],
    ["/api/v1/webhooks/website-leads", 32 * 1024, { authorization: `Bearer ${webhookSecret}` }, 422],
  ]) {
    const chunks = [Buffer.alloc(limit, 0x20), Buffer.from("{}")];
    for (const sizeHeaders of [{}, { "content-length": String(limit + 2) }]) {
      const result = await postChunks(path, chunks, { ...headers, ...sizeHeaders });
      assert.equal(result.status, 413, `${path} must reject oversized declared and chunked JSON`);
    }
    const boundary = await postChunks(path, [Buffer.alloc(limit - 2, 0x20), "{}"], headers);
    assert.equal(boundary.status, validationStatus, `${path}: JSON exactly at the byte limit must reach payload validation`);
    assert.equal(typeof boundary.body.error === "string" ? boundary.body.error : boundary.body.error.code,
      path.endsWith("website-leads") ? "Invalid lead payload." : "validation_error");
    assert.equal((await postChunks(path, ["{"], headers)).status, 400);
    assert.equal((await postChunks(path, [Buffer.from([0x22, 0xff, 0x22])], headers)).status, 400);
  }
  // Server Actions use a separate multipart body limit. Check the shared proxy
  // guard with both declared and chunked bodies, including a form POST without
  // the next-action header (progressive enhancement).
  const oversizedAction = [Buffer.alloc(8 * 1024 * 1024), Buffer.alloc(8 * 1024 * 1024 + 1)];
  for (const [path, actionHeaders] of [
    ["/documents", { "next-action": "invalid-action-for-size-check" }],
    ["/calendar", {}],
  ]) {
    for (const sizeHeaders of [{}, { "content-length": String(16 * 1024 * 1024 + 1) }]) {
      const result = await postChunks(path, oversizedAction, {
        cookie, "content-type": "multipart/form-data; boundary=crm-test", ...actionHeaders, ...sizeHeaders,
      });
      assert.equal(result.status, 413, `${path} must reject an oversized Server Action body with or without Content-Length`);
      assert.equal(result.body.error.code, "payload_too_large");
    }
  }
  assert.equal((await postChunks("/api/v1/webhooks/website-leads", ["{}"], {})).status, 401);
  console.log("Request-body checks passed for JSON routes and Server Actions: exact/chunked/declared limits, malformed JSON, invalid UTF-8 and authentication boundary.");
} finally {
  const logout = await fetch(`${origin}/api/v1/auth/logout`, {
    method: "POST", headers: { origin, cookie }, signal: AbortSignal.timeout(15_000),
  });
  assert.equal(logout.status, 200);
}
