/** @param {Readonly<Record<string, string | undefined>>} environment */
export function storageBackend(environment) {
  const backend = environment.DOCUMENT_STORAGE_BACKEND ?? "local";
  if (backend !== "local" && backend !== "s3") throw new Error("Invalid DOCUMENT_STORAGE_BACKEND.");
  return backend;
}

/** @param {Readonly<Record<string, string | undefined>>} environment */
export function parseS3Config(environment) {
  /** @param {string} name */
  function required(name) {
    const value = environment[name];
    if (!value || value !== value.trim()) throw new Error(`Invalid ${name}.`);
    return value;
  }
  const endpoint = required("DOCUMENT_S3_ENDPOINT");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("Invalid DOCUMENT_S3_ENDPOINT."); }
  const insecure = environment.DOCUMENT_S3_ALLOW_LOCAL_HTTP ?? "false";
  if (!["true", "false"].includes(insecure)) throw new Error("Invalid DOCUMENT_S3_ALLOW_LOCAL_HTTP.");
  const localHttp = insecure === "true" && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Invalid DOCUMENT_S3_ENDPOINT: HTTPS is required outside explicit loopback tests.");
  }
  const bucket = required("DOCUMENT_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error("Invalid DOCUMENT_S3_BUCKET.");
  }
  const forcePathStyle = environment.DOCUMENT_S3_FORCE_PATH_STYLE ?? "false";
  if (!["true", "false"].includes(forcePathStyle)) throw new Error("Invalid DOCUMENT_S3_FORCE_PATH_STYLE.");
  const timeout = environment.DOCUMENT_S3_TIMEOUT_MS ?? "30000";
  const timeoutMs = Number(timeout);
  if (!/^\d+$/.test(timeout) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error("Invalid DOCUMENT_S3_TIMEOUT_MS.");
  return {
    endpoint: url.origin, bucket, region: required("DOCUMENT_S3_REGION"),
    credentials: { accessKeyId: required("DOCUMENT_S3_ACCESS_KEY_ID"), secretAccessKey: required("DOCUMENT_S3_SECRET_ACCESS_KEY") },
    forcePathStyle: forcePathStyle === "true", timeoutMs,
  };
}
