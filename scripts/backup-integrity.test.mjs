import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { validateDocumentArchive, verifyBackupManifest, verifyRestoredFile } from "./backup-integrity.mjs";

const hash = (content) => createHash("sha256").update(content).digest("hex");
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), "crm-backup-integrity-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("manifest requires each expected member exactly once and verifies its checksum", async (t) => {
  const root = await directory(t);
  const names = ["database.dump", "documents.tar.gz", "metadata.json"];
  const lines = names.map((name) => `${hash(name)}  ${name}`);
  for (const name of names) await writeFile(join(root, name), name);
  await writeFile(join(root, "manifest.sha256"), `${lines.join("\n")}\n`);
  await verifyBackupManifest(root);
  for (const invalid of [
    [lines[0], lines[0], lines[0]],
    [lines[0], lines[1]],
    [...lines, lines[2]],
    [lines[0], lines[1], `${hash("other")}  other`],
    [lines[0], lines[1], `${hash("other")}  ../metadata.json`],
  ]) {
    await writeFile(join(root, "manifest.sha256"), invalid.join("\n"));
    await assert.rejects(verifyBackupManifest(root), /manifest is invalid/);
  }
  await writeFile(join(root, "manifest.sha256"), lines.join("\n"));
  await writeFile(join(root, "database.dump"), "corrupted");
  await assert.rejects(verifyBackupManifest(root), /checksum mismatch/);
});

test("manifest rejects linked members and an oversized manifest", async (t) => {
  const root = await directory(t);
  const names = ["database.dump", "documents.tar.gz", "metadata.json"];
  for (const name of names) await writeFile(join(root, name), name);
  await writeFile(join(root, "manifest.sha256"), names.map((name) => `${hash(name)}  ${name}`).join("\n"));
  await rm(join(root, "database.dump"));
  await symlink(join(root, "metadata.json"), join(root, "database.dump"));
  await assert.rejects(verifyBackupManifest(root), /regular files/);
  await rm(join(root, "database.dump"));
  await link(join(root, "metadata.json"), join(root, "database.dump"));
  await assert.rejects(verifyBackupManifest(root), /regular files/);
  await writeFile(join(root, "manifest.sha256"), " ".repeat(4097));
  await assert.rejects(verifyBackupManifest(root), /manifest is invalid/);
});

test("archive allows only unique generated storage paths, directories and regular files", () => {
  const organization = randomUUID();
  const record = randomUUID();
  const key = `${organization}/${record}/v1.pdf`;
  validateDocumentArchive(`./\n./${organization}/\n./${organization}/${record}/\n./${key}\n`, "drwx root\ndrwx org\ndrwx record\n-rw file\n");
  for (const path of ["../outside", "/outside", `./${organization}/../outside`, "./bad\\nname", "./bad\nname"]) {
    assert.throws(() => validateDocumentArchive(`${path}\n`, "-rw file\n"));
  }
  for (const kind of ["l", "h", "b", "c", "p", "s"]) {
    assert.throws(() => validateDocumentArchive(`${key}\n`, `${kind}rw file\n`), /unsupported/);
  }
  assert.throws(() => validateDocumentArchive(`${key}\n`, `-rw file -> target\n`), /unsupported/);
  assert.throws(() => validateDocumentArchive(`${key}\n${key}\n`, "-rw file\n-rw file\n"), /duplicate/);
});

async function fileFixture(t) {
  const root = await directory(t);
  const organizationId = randomUUID();
  const key = `${organizationId}/${randomUUID()}/v1.pdf`;
  const content = Buffer.from("retained historical document");
  const path = join(root, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { root, path, reference: { organization_id: organizationId, storage_key: key, size_bytes: String(content.length), sha256: hash(content) } };
}

test("restored file verification checks bytes rather than only archive checksums", async (t) => {
  const { root, path, reference } = await fileFixture(t);
  assert.equal(await verifyRestoredFile(root, reference), Number(reference.size_bytes));
  await writeFile(path, Buffer.alloc(Number(reference.size_bytes)));
  await assert.rejects(verifyRestoredFile(root, reference), /checksum/);
  await writeFile(path, "short");
  await assert.rejects(verifyRestoredFile(root, reference), /size or type/);
  await rm(path);
  await assert.rejects(verifyRestoredFile(root, reference), { code: "ENOENT" });
});

test("restored file verification rejects traversal, cross-company keys and invalid metadata", async (t) => {
  const { root, reference } = await fileFixture(t);
  for (const override of [
    { storage_key: "../outside" }, { organization_id: randomUUID() },
    { size_bytes: "0" }, { size_bytes: "15728641" }, { size_bytes: "NaN" },
    { sha256: "not-a-hash" },
  ]) await assert.rejects(verifyRestoredFile(root, { ...reference, ...override }), /invalid metadata/);
});

test("restored file verification refuses hard links, symlinks and linked parent directories", async (t) => {
  const { root, path, reference } = await fileFixture(t);
  await link(path, join(root, "linked"));
  await assert.rejects(verifyRestoredFile(root, reference), /size or type/);
  await rm(join(root, "linked"));
  await rm(path);
  await symlink(join(root, "outside"), path);
  await assert.rejects(verifyRestoredFile(root, reference));
  await rm(dirname(path), { recursive: true });
  await symlink(root, dirname(path));
  await assert.rejects(verifyRestoredFile(root, reference), /non-directory/);
});
