import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { workflowTaskIdempotencyKey } from "./worker-engine.ts";

test("each Workflow action receives a stable distinct task idempotency key", () => {
  const job = randomUUID();
  const action = randomUUID();
  const key = workflowTaskIdempotencyKey(job, action);
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(workflowTaskIdempotencyKey(job, action), key);
  assert.notEqual(workflowTaskIdempotencyKey(job, randomUUID()), key);
  assert.notEqual(workflowTaskIdempotencyKey(randomUUID(), action), key);
});
