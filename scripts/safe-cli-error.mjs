// Keep operational logs free of arbitrary exception messages and provider-defined codes.
const SAFE_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "ENOSPC", "EACCES", "EIO",
  "23503", "23505", "40001", "40P01", "53300", "57014", "57P01",
]);

export function safeCliErrorCode(error, fallback) {
  if (!error || typeof error !== "object") return fallback;
  try {
    const code = "code" in error ? error.code : undefined;
    return typeof code === "string" && SAFE_CODES.has(code) ? code : fallback;
  } catch {
    return fallback;
  }
}
