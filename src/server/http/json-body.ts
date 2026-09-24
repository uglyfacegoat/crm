export class RequestBodyTooLargeError extends Error {
  constructor() { super("Request body exceeds its byte limit."); }
}

export class InvalidJsonBodyError extends Error {
  constructor() { super("Request body is not valid UTF-8 JSON."); }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("A positive body byte limit is required.");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new InvalidJsonBodyError();
    if (Number(declaredLength) > maxBytes) {
      await request.body?.cancel();
      throw new RequestBodyTooLargeError();
    }
  }
  if (!request.body) throw new InvalidJsonBodyError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
