import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { parseS3Config } from "./s3-config.mjs";
import { StoredFileIntegrityError, validateFileExpectation, validateStorageKey } from "./file-integrity.mjs";

class StorageOperationError extends Error {
  /** @param {string} operation @param {unknown} cause @param {string} code */
  constructor(operation, cause, code) {
    super(`Object storage ${operation} failed (${code}).`, { cause });
    this.name = "StorageOperationError";
    this.code = code;
  }
}

/** @param {Readonly<Record<string, string | undefined>>} environment */
export function createS3Storage(environment) {
  const config = parseS3Config(environment);
  const clientOptions = {
    endpoint: config.endpoint, region: config.region, credentials: config.credentials,
    forcePathStyle: config.forcePathStyle,
    followRegionRedirects: false,
    requestHandler: { connectionTimeout: Math.min(config.timeoutMs, 5000), requestTimeout: config.timeoutMs },
  };
  // Mutations are not retried: an uncertain PUT can return 412 after it committed.
  const client = new S3Client({ ...clientOptions, maxAttempts: 1 });
  const reader = new S3Client({ ...clientOptions, maxAttempts: 2 });

  /** @param {string} operation @param {unknown} error @param {AbortSignal} signal */
  function failure(operation, error, signal) {
    if (error instanceof StoredFileIntegrityError) return error;
    const status = error && typeof error === "object" && "$metadata" in error ? error.$metadata?.httpStatusCode : undefined;
    const name = error instanceof Error ? error.name : "";
    const code = signal.aborted ? "ETIMEDOUT" : status === 412 ? "EEXIST" : name === "NoSuchKey" ? "ENOENT" : status === 403 ? "EACCES" : "ESTORAGE";
    return new StorageOperationError(operation, error, code);
  }

  return {
    /** @param {string} key @param {Buffer} bytes */
    async write(key, bytes) {
      validateStorageKey(key);
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 15 * 1024 * 1024) throw new RangeError("Invalid object upload size.");
      const signal = AbortSignal.timeout(config.timeoutMs);
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucket, Key: key, Body: bytes, ContentLength: bytes.length,
          IfNoneMatch: "*", ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
          ContentType: "application/octet-stream",
        }), { abortSignal: signal });
      } catch (error) { throw failure("write", error, signal); }
    },
    /** @param {string} key @param {{sizeBytes: number, sha256: string}} expected @param {number} maxBytes */
    async readVerified(key, expected, maxBytes) {
      validateStorageKey(key);
      validateFileExpectation(expected, maxBytes);
      const signal = AbortSignal.timeout(config.timeoutMs);
      /** @type {Readable | undefined} */
      let body;
      const abort = () => body?.destroy(new Error("Object read timed out."));
      try {
        const response = await reader.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: signal });
        if (!(response.Body instanceof Readable)) throw new Error("Expected a Node object response stream.");
        body = response.Body;
        signal.addEventListener("abort", abort, { once: true });
        signal.throwIfAborted();
        if (response.ContentLength !== expected.sizeBytes) throw new StoredFileIntegrityError();
        const bytes = Buffer.alloc(expected.sizeBytes);
        let offset = 0;
        for await (const chunk of body) {
          if (!(chunk instanceof Uint8Array) || chunk.length > bytes.length - offset) throw new StoredFileIntegrityError();
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if (offset !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new StoredFileIntegrityError();
        return bytes;
      } catch (error) { throw failure("read", error, signal); }
      finally { signal.removeEventListener("abort", abort); body?.destroy(); }
    },
    /** @param {string} key */
    async remove(key) {
      validateStorageKey(key);
      const signal = AbortSignal.timeout(config.timeoutMs);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: signal });
      } catch (error) { throw failure("remove", error, signal); }
    },
    close() { client.destroy(); reader.destroy(); },
  };
}
