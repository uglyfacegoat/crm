export function matchesRequestOrigin(origin: string | null, allowedOrigins: readonly string[]) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}
