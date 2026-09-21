export function safeLoginRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  // Browsers normalize backslashes and strip control characters when resolving URLs.
  if (value.includes("\\") || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "/";
  return value;
}
