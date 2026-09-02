export type SameOriginInput = {
  origin: string;
  requestUrl: string;
  host: string | null;
  forwardedHost: string | null;
  forwardedProtocol: string | null;
};

export function matchesRequestOrigin(input: SameOriginInput) {
  try {
    const originUrl = new URL(input.origin);
    const requestUrl = new URL(input.requestUrl);
    const expectedHost = input.host?.trim()
      || input.forwardedHost?.split(",")[0]?.trim()
      || requestUrl.host;
    const expectedProtocol = input.forwardedProtocol?.split(",")[0]?.trim()
      || requestUrl.protocol.slice(0, -1);
    return originUrl.host === expectedHost && originUrl.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}
