import { cp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { verifyBackupManifest } from "./backup-integrity.mjs";
import { sha256File } from "./backup-process.mjs";

const ARCHIVE_PATTERN = /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/;
const ARCHIVE_MEMBERS = ["database.dump", "documents.tar.gz", "manifest.sha256", "metadata.json"];

export async function exportArchive({ backupExportRoot, archiveName, archiveDirectory, copyDirectory = cp }) {
  if (!backupExportRoot) return null;
  if (!ARCHIVE_PATTERN.test(archiveName)) throw new Error("Backup archive name is invalid.");
  const partialDirectory = join(backupExportRoot, `.partial-${archiveName}`);
  const exportedDirectory = join(backupExportRoot, archiveName);
  await rm(partialDirectory, { recursive: true, force: true });
  try {
    const sourceManifestSha256 = await sha256File(join(archiveDirectory, "manifest.sha256"));
    await copyDirectory(archiveDirectory, partialDirectory, { recursive: true, force: false, errorOnExist: true });
    const members = (await readdir(partialDirectory)).sort();
    if (members.length !== ARCHIVE_MEMBERS.length || members.some((name, index) => name !== ARCHIVE_MEMBERS[index])) {
      throw new Error("Exported backup members do not match the complete manifest.");
    }
    await verifyBackupManifest(partialDirectory);
    if (await sha256File(join(partialDirectory, "manifest.sha256")) !== sourceManifestSha256) {
      throw new Error("Exported backup manifest differs from its source.");
    }
    await rename(partialDirectory, exportedDirectory);
    return new Date().toISOString();
  } catch (error) {
    await rm(partialDirectory, { recursive: true, force: true });
    throw error;
  }
}
