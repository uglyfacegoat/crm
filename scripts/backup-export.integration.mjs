import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportArchive } from "./backup-export.mjs";
import { verifyBackupManifest } from "./backup-integrity.mjs";

test("export publishes only a complete byte-verified copy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "crm-backup-export-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const backupExportRoot = join(root, "export");
  await mkdir(backupExportRoot);

  async function source() {
    const archiveName = `20260923T180000Z-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const archiveDirectory = join(root, archiveName);
    await mkdir(archiveDirectory);
    const members = {
      "database.dump": Buffer.from("private database dump"),
      "documents.tar.gz": Buffer.from("private documents archive"),
      "metadata.json": Buffer.from('{"formatVersion":2}'),
    };
    for (const [name, bytes] of Object.entries(members)) await writeFile(join(archiveDirectory, name), bytes);
    const manifest = Object.entries(members).map(([name, bytes]) =>
      `${createHash("sha256").update(bytes).digest("hex")}  ${name}`).join("\n") + "\n";
    await writeFile(join(archiveDirectory, "manifest.sha256"), manifest);
    return { archiveName, archiveDirectory, members, manifest };
  }

  const good = await source();
  const exportedAt = await exportArchive({ backupExportRoot, ...good });
  assert.ok(Number.isFinite(Date.parse(exportedAt)));
  await verifyBackupManifest(join(backupExportRoot, good.archiveName));
  assert.deepEqual(await readFile(join(backupExportRoot, good.archiveName, "database.dump")), good.members["database.dump"]);
  assert.deepEqual(await readFile(join(good.archiveDirectory, "database.dump")), good.members["database.dump"]);

  const corrupt = await source();
  await assert.rejects(exportArchive({ backupExportRoot, ...corrupt,
    async copyDirectory(from, to, options) {
      await cp(from, to, options);
      await writeFile(join(to, "database.dump"), Buffer.from("corrupt copied bytes"));
    },
  }), /checksum mismatch/);
  assert.equal((await readdir(backupExportRoot)).includes(corrupt.archiveName), false);
  assert.equal((await readdir(backupExportRoot)).includes(`.partial-${corrupt.archiveName}`), false);
  assert.deepEqual(await readFile(join(corrupt.archiveDirectory, "database.dump")), corrupt.members["database.dump"]);

  const forged = await source();
  await assert.rejects(exportArchive({ backupExportRoot, ...forged,
    async copyDirectory(from, to, options) {
      await cp(from, to, options);
      const modified = Buffer.from("different complete export");
      await writeFile(join(to, "database.dump"), modified);
      await writeFile(join(to, "manifest.sha256"), forged.manifest.replace(
        createHash("sha256").update(forged.members["database.dump"]).digest("hex"),
        createHash("sha256").update(modified).digest("hex")));
    },
  }), /manifest differs/);
  assert.equal((await readdir(backupExportRoot)).includes(forged.archiveName), false);

  const extra = await source();
  await assert.rejects(exportArchive({ backupExportRoot, ...extra,
    async copyDirectory(from, to, options) {
      await cp(from, to, options);
      await writeFile(join(to, "unexpected.txt"), "not part of backup");
    },
  }), /complete manifest/);
  assert.deepEqual(await readdir(backupExportRoot), [good.archiveName]);
});
