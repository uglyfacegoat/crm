import assert from "node:assert/strict";
import test from "node:test";
import { InvalidJsonBodyError, readJsonBody, RequestBodyTooLargeError } from "./json-body.ts";

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const options = { method: "POST", headers, body, duplex: "half" };
  return { request: new Request("http://localhost/test", options), pulls: () => pulls, cancelled: () => cancelled };
}

test("JSON body accepts exactly the byte limit, including split UTF-8 sequences", async () => {
  const bytes = Buffer.from('{"name":"Москва"}');
  const fixture = streamedRequest([bytes.subarray(0, 10), bytes.subarray(10)]);
  assert.deepEqual(await readJsonBody(fixture.request, bytes.length), { name: "Москва" });
});

const lengthHeaders: Record<string, string>[] = [{}, { "content-length": "1" }];
for (const headers of lengthHeaders) {
  test(`JSON body stops oversized streams ${Object.keys(headers).length ? "with understated" : "without"} Content-Length`, async () => {
    const fixture = streamedRequest([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(1_000_000)], headers);
    await assert.rejects(readJsonBody(fixture.request, 12), RequestBodyTooLargeError);
    assert.equal(fixture.pulls(), 2, "The remainder must not be read into memory");
    assert.equal(fixture.cancelled(), true);
  });
}

test("declared oversized JSON is rejected without pulling the body", async () => {
  const fixture = streamedRequest([Buffer.alloc(100)], { "content-length": "100" });
  await assert.rejects(readJsonBody(fixture.request, 10), RequestBodyTooLargeError);
  assert.equal(fixture.pulls(), 0);
  assert.equal(fixture.cancelled(), true);
});

test("JSON limits count bytes, not characters", async () => {
  const fixture = streamedRequest([Buffer.from('"ЯЯ"')]);
  await assert.rejects(readJsonBody(fixture.request, 4), RequestBodyTooLargeError);
});

test("empty, malformed and invalid UTF-8 JSON is rejected", async () => {
  for (const body of [Buffer.alloc(0), Buffer.from("{"), Buffer.from([0x22, 0xff, 0x22])]) {
    await assert.rejects(readJsonBody(streamedRequest([body]).request, 100), InvalidJsonBodyError);
  }
  await assert.rejects(readJsonBody(new Request("http://localhost"), 100), InvalidJsonBodyError);
});

test("invalid declared lengths and invalid server limits are rejected", async () => {
  for (const value of ["-1", "NaN", "1.5", "1, 2"]) {
    await assert.rejects(readJsonBody(streamedRequest([], { "content-length": value }).request, 10), InvalidJsonBodyError);
  }
  for (const maxBytes of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(readJsonBody(new Request("http://localhost"), maxBytes), RangeError);
  }
});

test("stream failures are not mislabeled as malformed JSON", async () => {
  const failure = new Error("Source stream failed");
  const body = new ReadableStream<Uint8Array>({ pull() { throw failure; } });
  const options = { method: "POST", body, duplex: "half" };
  await assert.rejects(readJsonBody(new Request("http://localhost", options), 100), (error) => error === failure);
  assert.equal(body.locked, false);
});
