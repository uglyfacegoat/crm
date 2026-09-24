import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");

test("file write drain waits for in-flight work, rejects new work, and survives a new operator connection", { timeout: 15_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `crm_file_drain_test_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1 });
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const { withFileWriteLease, recordFileWriteKey, markFileWriteUncertain, FileWritesPausedError, closeFileWriteGate } = await import("../src/server/file-writes/gate.mjs");
  t.after(async () => {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await closeFileWriteGate();
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl, onApplied: () => {} });
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "inspect" }), /Pause file writes/);
  await assert.rejects(recordFileWriteKey("outside-lease"), /active file write lease/);
  let started;
  let release;
  const entered = new Promise((resolve) => { started = resolve; });
  const proceed = new Promise((resolve) => { release = resolve; });
  const inFlight = withFileWriteLease(async () => {
    await recordFileWriteKey("tenant/document/v1.pdf");
    await recordFileWriteKey("tenant/document/v1.pdf");
    started(); await proceed; return "committed";
  });
  await entered;
  assert.deepEqual((await sql`SELECT storage_keys FROM file_write_operations`)[0].storage_keys, ["tenant/document/v1.pdf"]);
  let secondStarted;
  let releaseSecond;
  const secondEntered = new Promise((resolve) => { secondStarted = resolve; });
  const secondProceed = new Promise((resolve) => { releaseSecond = resolve; });
  const secondInFlight = withFileWriteLease(async () => { secondStarted(); await secondProceed; return "second commit"; });
  await secondEntered;

  let flagSet;
  const waiting = new Promise((resolve) => { flagSet = resolve; });
  const drain = setFileWriteMode({ databaseUrl, mode: "pause", onWaiting: flagSet });
  await waiting;
  assert.equal((await sql`SELECT accepting FROM file_write_control`)[0].accepting, false);
  const race = await Promise.race([drain.then(() => "drained"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))]);
  assert.equal(race, "waiting", "Drain must wait until the complete operation exits its lease");
  release();
  assert.equal(await inFlight, "committed");
  assert.equal(await Promise.race([drain.then(() => "drained"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))]), "waiting", "One remaining upload must keep the drain open");
  releaseSecond();
  assert.equal(await secondInFlight, "second commit");
  assert.deepEqual({ accepting: (await drain).accepting, pending: (await setFileWriteMode({ databaseUrl, mode: "status" })).pending }, { accepting: false, pending: 0 });
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "status" })).accepting, false);
  await assert.rejects(withFileWriteLease(async () => assert.fail("Paused writer reached storage")), FileWritesPausedError);
  const restartedWriter = spawnSync(process.execPath, ["--input-type=module", "-e",
    'import { withFileWriteLease, closeFileWriteGate } from "./src/server/file-writes/gate.mjs"; try { await withFileWriteLease(async () => { throw new Error("Paused restart reached storage"); }); } finally { await closeFileWriteGate(); }'],
  { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 5_000 });
  assert.equal(restartedWriter.error, undefined);
  assert.equal(restartedWriter.status, 1);
  assert.match(restartedWriter.stderr, /FileWritesPausedError/);
  assert.doesNotMatch(restartedWriter.stderr, /Paused restart reached storage/);
  const seedEnvironment = {
    ...process.env, DATABASE_URL: databaseUrl, LOCAL_EXAMPLE_SEED: "CONFIRM_LOCAL_CRM_EXAMPLE_DATA",
    LOCAL_EXAMPLE_CENTER_ID: randomUUID(), DOCUMENT_STORAGE_ROOT: "/tmp/crm-file-drain-seed",
  };
  for (const [backend, expected] of [["local", /File uploads are temporarily paused/], ["s3", /local document storage/], ["unexpected", /DOCUMENT_STORAGE_BACKEND/]]) {
    const seed = spawnSync(process.execPath, ["scripts/seed-local-example-data.mjs", "--apply"], {
      env: { ...seedEnvironment, DOCUMENT_STORAGE_BACKEND: backend }, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(seed.error, undefined);
    assert.equal(seed.status, 1);
    assert.match(seed.stderr, expected);
    assert.doesNotMatch(seed.stderr, /do-not-log-this/);
  }
  const transferId = randomUUID();
  await sql`INSERT INTO file_storage_transfers
    (id, direction, case_id, actor, database_role, reference_sha256,
      reference_counts, file_count, total_bytes, state)
    VALUES (${transferId}, 'local_to_s3', 'DRAIN-TRANSFER', 'Test operator', current_user,
      ${"0".repeat(64)}, ${sql.json({})}, 0, 0, 'prepared')`;
  const transferStatus = await setFileWriteMode({ databaseUrl, mode: "status" });
  assert.equal(transferStatus.transfersPending, 1);
  assert.equal(transferStatus.drained, false);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unfinished file storage transfer/);
  await sql`UPDATE file_storage_transfers SET state = 'complete', completed_at = now() WHERE id = ${transferId}`;
  await assert.rejects(sql`DELETE FROM file_storage_transfers WHERE id = ${transferId}`, /append-only/);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "status" })).drained, true);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "resume" })).accepting, true);
  assert.equal(await withFileWriteLease(async () => "accepted"), "accepted");

  assert.equal(await withFileWriteLease(async () => {
    await recordFileWriteKey("tenant/uncertain/v1.pdf");
    markFileWriteUncertain();
    return "outcome unknown";
  }), "outcome unknown");
  const uncertainPause = await setFileWriteMode({ databaseUrl, mode: "pause" });
  assert.equal(uncertainPause.drained, false, "A handled uncertain outcome must retain its operation row");
  assert.deepEqual((await setFileWriteMode({ databaseUrl, mode: "inspect" })).operations[0].storageKeys, ["tenant/uncertain/v1.pdf"]);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unresolved file write/);
  await sql`DELETE FROM file_write_operations`;
  await setFileWriteMode({ databaseUrl, mode: "resume" });

  const holder = spawn(process.execPath, ["scripts/fixtures/file-lease-holder.mjs"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "pipe", "pipe"],
  });
  const holderReady = new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.once("exit", (code) => reject(new Error(`Lease holder exited early: ${code}`)));
    holder.stdout.once("data", (chunk) => chunk.toString().includes("leased") ? resolve() : reject(new Error("Lease holder did not acquire a lease")));
  });
  try {
    await holderReady;
    let crashFlagSet;
    const flagSetAfterCrash = new Promise((resolve) => { crashFlagSet = resolve; });
    const crashDrain = setFileWriteMode({ databaseUrl, mode: "pause", onWaiting: crashFlagSet });
    await flagSetAfterCrash;
    assert.equal(await Promise.race([crashDrain.then(() => "drained"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))]), "waiting");
    holder.kill("SIGKILL");
    const crashed = await crashDrain;
    assert.equal(crashed.accepting, false);
    assert.equal(crashed.pending, 1, "A crashed process leaves a durable unresolved operation");
    assert.equal(crashed.drained, false);
    const inspection = await setFileWriteMode({ databaseUrl, mode: "inspect" });
    assert.equal(inspection.accepting, false);
    assert.equal(inspection.pending, 1);
    assert.equal(inspection.drained, false);
    assert.equal(inspection.nextCursor, null);
    assert.match(inspection.operations[0].id, /^[0-9a-f-]{36}$/);
    assert.ok(inspection.operations[0].startedAt instanceof Date);
    assert.deepEqual(inspection.operations[0].storageKeys, ["tenant/interrupted/v1.pdf"]);
    await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unresolved file write/);
    // In the isolated fixture only: simulate an operator who stopped all writers
    // and reconciled the file before clearing the unresolved operation.
    await sql`DELETE FROM file_write_operations`;
    assert.equal((await setFileWriteMode({ databaseUrl, mode: "inspect" })).drained, true);
    await setFileWriteMode({ databaseUrl, mode: "resume" });
  } finally {
    holder.kill("SIGKILL");
  }

  const disconnectedHolder = spawn(process.execPath, ["scripts/fixtures/file-lease-holder.mjs"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      disconnectedHolder.once("error", reject);
      disconnectedHolder.once("exit", (code) => reject(new Error(`Disconnected holder exited early: ${code}`)));
      disconnectedHolder.stdout.once("data", (chunk) => chunk.toString().includes("leased") ? resolve() : reject(new Error("Disconnected holder did not acquire a lease")));
    });
    const [lockHolder] = await sql`SELECT pid FROM pg_locks
      WHERE locktype = 'advisory' AND classid = 839211 AND objid = 1 AND mode = 'ShareLock'`;
    assert.ok(lockHolder?.pid);
    await sql`SELECT pg_terminate_backend(${lockHolder.pid})`;
    const disconnectedDrain = await setFileWriteMode({ databaseUrl, mode: "pause" });
    assert.equal(disconnectedDrain.drained, false, "A lost advisory lock cannot hide an unfinished file operation");
    assert.equal(disconnectedDrain.pending, 1);
    await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unresolved file write/);
    const holderExited = disconnectedHolder.exitCode !== null || disconnectedHolder.signalCode !== null
      ? Promise.resolve() : new Promise((resolve) => disconnectedHolder.once("exit", resolve));
    disconnectedHolder.kill("SIGKILL");
    await holderExited;
    await sql`DELETE FROM file_write_operations`;
    await setFileWriteMode({ databaseUrl, mode: "resume" });
  } finally {
    disconnectedHolder.kill("SIGKILL");
  }

  await setFileWriteMode({ databaseUrl, mode: "pause" });
  await sql`INSERT INTO file_write_operations (id)
    SELECT gen_random_uuid() FROM generate_series(1, 101)`;
  const firstPage = await setFileWriteMode({ databaseUrl, mode: "inspect" });
  assert.equal(firstPage.pending, 101);
  assert.equal(firstPage.operations.length, 100);
  assert.ok(firstPage.nextCursor);
  const lastPage = await setFileWriteMode({ databaseUrl, mode: "inspect", afterId: firstPage.nextCursor });
  assert.equal(lastPage.operations.length, 1);
  assert.equal(lastPage.nextCursor, null);
  assert.equal(new Set([...firstPage.operations, ...lastPage.operations].map(({ id }) => id)).size, 101);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "inspect", afterId: "invalid" }), /operation ID cursor/);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "status", afterId: firstPage.nextCursor }), /operation ID cursor/);
  await sql`DELETE FROM file_write_operations`;
  await setFileWriteMode({ databaseUrl, mode: "resume" });
});
