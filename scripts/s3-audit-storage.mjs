import { S3Client, GetBucketVersioningCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { parseS3Config } from "../src/server/storage/s3-config.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";

function decodeKey(encoded) {
  // S3-compatible services may encode spaces as '+'; a literal plus is '%2B'.
  return decodeURIComponent(encoded.replaceAll("+", "%20"));
}

// Kept out of the application storage API: inventory needs a separate read-only identity.
export function createS3AuditStorage(environment) {
  const config = parseS3Config(environment);
  const files = createS3Storage(environment);
  const client = new S3Client({
    endpoint: config.endpoint, region: config.region, credentials: config.credentials,
    forcePathStyle: config.forcePathStyle, followRegionRedirects: false, maxAttempts: 2,
    requestHandler: { connectionTimeout: Math.min(config.timeoutMs, 5000), requestTimeout: config.timeoutMs },
  });

  async function send(command) {
    const signal = AbortSignal.timeout(config.timeoutMs);
    try { return await client.send(command, { abortSignal: signal }); }
    catch (cause) {
      const error = new Error("Object storage inventory request failed.", { cause });
      error.code = signal.aborted ? "ETIMEDOUT" : cause.$metadata?.httpStatusCode === 403 ? "EACCES" : "ESTORAGE";
      throw error;
    }
  }

  return {
    readVerified: files.readVerified,
    async versioning() {
      const response = await send(new GetBucketVersioningCommand({ Bucket: config.bucket }));
      if (response.Status === undefined) return "Disabled";
      if (!["Enabled", "Suspended"].includes(response.Status)) throw new Error("Invalid bucket versioning response.");
      return response.Status;
    },
    async *inventory() {
      let keyMarker;
      let versionIdMarker;
      const markers = new Set();
      for (;;) {
        const response = await send(new ListObjectVersionsCommand({
          Bucket: config.bucket, MaxKeys: 100, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker,
          EncodingType: "url",
        }));
        if (response.Name !== config.bucket || typeof response.IsTruncated !== "boolean" || response.CommonPrefixes?.length
          || response.EncodingType !== "url") throw new Error("Incomplete object inventory response.");
        for (const [kind, entries] of [["object", response.Versions], ["delete-marker", response.DeleteMarkers]]) {
          if (entries !== undefined && !Array.isArray(entries)) throw new Error("Invalid object inventory entries.");
          for (const entry of entries ?? []) {
            if (typeof entry.Key !== "string" || !entry.Key || typeof entry.VersionId !== "string" || !entry.VersionId
              || typeof entry.IsLatest !== "boolean" || !(entry.LastModified instanceof Date)
              || !Number.isFinite(entry.LastModified.getTime())
              || (kind === "object" && (!Number.isSafeInteger(entry.Size) || entry.Size < 0))) {
              throw new Error("Invalid object version metadata.");
            }
            yield {
              storageKey: decodeKey(entry.Key), versionId: entry.VersionId, isLatest: entry.IsLatest,
              modifiedAt: entry.LastModified.toISOString(), sizeBytes: kind === "object" ? entry.Size : 0, kind,
            };
          }
        }
        if (!response.IsTruncated) return;
        if (typeof response.NextKeyMarker !== "string" || !response.NextKeyMarker
          || typeof response.NextVersionIdMarker !== "string" || !response.NextVersionIdMarker) {
          throw new Error("Truncated inventory is missing continuation markers.");
        }
        keyMarker = decodeKey(response.NextKeyMarker);
        versionIdMarker = response.NextVersionIdMarker;
        const marker = JSON.stringify([keyMarker, versionIdMarker]);
        if (markers.has(marker)) throw new Error("Object inventory pagination did not advance.");
        markers.add(marker);
      }
    },
    close() { client.destroy(); files.close(); },
  };
}
