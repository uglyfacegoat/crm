import { isIP } from "node:net";

export function getTrustedClientAddress(headers: Headers, trustProxy: boolean) {
  if (!trustProxy) return null;
  // The single trusted ingress must overwrite this header, never append client input.
  const address = headers.get("x-real-ip")?.trim();
  return address && isIP(address) ? address : null;
}
