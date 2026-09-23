const SAFE_ERROR_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "ENOSPC", "EACCES", "EIO",
  "23503", "23505", "40001", "40P01", "53300", "57014", "57P01",
]);

export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "NON_ERROR_THROWN";
  try {
    const code = "code" in error ? error.code : undefined;
    return typeof code === "string" && SAFE_ERROR_CODES.has(code) ? code : "UNEXPECTED";
  } catch {
    return "UNEXPECTED";
  }
}
