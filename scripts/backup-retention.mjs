import { readdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const ARCHIVE_PATTERN = /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/;

function isPathInside(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent !== "" && !pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..";
}

export async function removeExpiredArchives(root, now, retentionDays, protectedArchiveNames = []) {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const protectedNames = new Set(protectedArchiveNames.filter(Boolean));
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !ARCHIVE_PATTERN.test(entry.name) || protectedNames.has(entry.name)) continue;
    const timestamp = Date.UTC(
      Number(entry.name.slice(0, 4)),
      Number(entry.name.slice(4, 6)) - 1,
      Number(entry.name.slice(6, 8)),
      Number(entry.name.slice(9, 11)),
      Number(entry.name.slice(11, 13)),
      Number(entry.name.slice(13, 15)),
    );
    if (!Number.isFinite(timestamp) || timestamp >= cutoff) continue;
    const archivePath = resolve(root, entry.name);
    if (!isPathInside(root, archivePath)) throw new Error("Refusing to remove a backup outside the configured root.");
    await rm(archivePath, { recursive: true });
  }
}
