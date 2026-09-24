import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { removeExpiredArchives } from "./backup-retention.mjs";

test("retention preserves the last accepted and pending verified archives", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "crm-backup-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const accepted = "20000101T000000Z-aaaaaaaa";
  const pending = "20000102T000000Z-bbbbbbbb";
  const expired = "20000103T000000Z-cccccccc";
  const fresh = "20260922T000000Z-dddddddd";
  for (const name of [accepted, pending, expired, fresh, "notes"]) await mkdir(join(root, name));
  await symlink(join(root, expired), join(root, "20000104T000000Z-eeeeeeee"));

  await removeExpiredArchives(root, new Date("2026-09-23T00:00:00Z"), 30, [accepted, pending]);

  assert.deepEqual((await readdir(root)).sort(),
    [accepted, pending, fresh, "notes", "20000104T000000Z-eeeeeeee"].sort());
});
