import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const MAX_TRANSCODED_BYTES = 20 * 1024 * 1024;
const MAX_CACHED_BYTES = 24 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60_000;
const cached = new Map<string, { data: Buffer; expiresAt: number }>();
const pending = new Map<string, Promise<Buffer>>();
let cachedBytes = 0;

function removeCached(key: string) {
  const entry = cached.get(key);
  if (!entry) return;
  cachedBytes -= entry.data.length;
  cached.delete(key);
}

function remember(key: string, data: Buffer) {
  if (data.length > MAX_CACHED_BYTES) return;
  const now = Date.now();
  for (const [existingKey, entry] of cached) if (entry.expiresAt <= now) removeCached(existingKey);
  removeCached(key);
  while (cachedBytes + data.length > MAX_CACHED_BYTES) {
    const oldestKey = cached.keys().next().value;
    if (!oldestKey) break;
    removeCached(oldestKey);
  }
  cached.set(key, { data, expiresAt: now + CACHE_TTL_MS });
  cachedBytes += data.length;
}

/** Provide a universally playable stream for browsers that cannot decode WebM/Opus. */
export function transcodeWebmToMp3(input: Buffer): Promise<Buffer> {
  const key = createHash("sha256").update(input).digest("hex");
  const hit = cached.get(key);
  if (hit) {
    if (hit.expiresAt > Date.now()) {
      cached.delete(key);
      cached.set(key, hit);
      return Promise.resolve(hit.data);
    }
    removeCached(key);
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = new Promise<Buffer>((resolve, reject) => {
    const process = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-i", "pipe:0",
      "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const timeout = setTimeout(() => process.kill("SIGKILL"), 30_000);
    timeout.unref?.();
    process.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_TRANSCODED_BYTES) {
        failed = true;
        process.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    // Drain diagnostics without exposing them in user-facing errors or logs.
    process.stderr.on("data", () => {});
    process.on("error", (error) => { clearTimeout(timeout); reject(error); });
    process.on("close", (code) => {
      clearTimeout(timeout);
      if (failed || code !== 0 || size === 0) reject(new Error("Audio transcoding failed."));
      else resolve(Buffer.concat(chunks, size));
    });
    process.stdin.on("error", () => {});
    process.stdin.end(input);
  }).then((data) => {
    pending.delete(key);
    remember(key, data);
    return data;
  }, (error: unknown) => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, task);
  return task;
}
