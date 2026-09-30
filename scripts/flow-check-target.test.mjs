import assert from "node:assert/strict";
import test from "node:test";
import { assertFlowCheckTarget } from "./flow-check-target.mjs";

test("browser flow checks require an explicit working-data acknowledgement", () => {
  assert.throws(() => assertFlowCheckTarget({ args: [], environment: {} }), /--allow-working-flow-check/);
  assert.doesNotThrow(() => assertFlowCheckTarget({ args: ["--allow-working-flow-check"],
    environment: { VISUAL_BASE_URL: "http://127.0.0.1:3000" } }));
});

test("remote browser flow checks require a second explicit acknowledgement", () => {
  const environment = { ORDER_COPY_CHECK_BASE_URL: "https://crm.example.com" };
  assert.throws(() => assertFlowCheckTarget({ args: ["--allow-working-flow-check"], environment }),
    /ORDER_COPY_CHECK_BASE_URL.*--allow-remote-flow-check/);
  assert.doesNotThrow(() => assertFlowCheckTarget({
    args: ["--allow-working-flow-check", "--allow-remote-flow-check"], environment,
  }));
});

test("a local browser cannot silently use a remote direct database", () => {
  const environment = { ORDER_COPY_CHECK_BASE_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://user:secret@db.example.com/crm" };
  assert.throws(() => assertFlowCheckTarget({ args: ["--allow-working-flow-check"], environment }),
    /DATABASE_URL.*--allow-remote-flow-check/);
  assert.doesNotThrow(() => assertFlowCheckTarget({ args: ["--allow-working-flow-check"],
    environment: { DATABASE_URL: "postgresql://user:secret@127.0.0.1:54329/crm" } }));
});

test("browser flow target errors never print the URL or credentials", () => {
  assert.throws(() => assertFlowCheckTarget({ args: ["--allow-working-flow-check"],
    environment: { CONTRACT_CHECK_BASE_URL: "https://user:secret@crm.example.com" } }),
  (error) => !String(error).includes("secret") && String(error).includes("CONTRACT_CHECK_BASE_URL"));
});
