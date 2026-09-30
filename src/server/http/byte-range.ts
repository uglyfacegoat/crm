export type ByteRange = { kind: "full" } | { kind: "unsatisfiable" } | { kind: "partial"; start: number; end: number };

export function selectByteRange(header: string | null, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("Invalid representation size.");
  if (!header || !header.startsWith("bytes=")) return { kind: "full" };
  // Multipart ranges are intentionally unsupported; HTTP permits ignoring Range.
  if (header.includes(",")) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return { kind: "unsatisfiable" };
  const first = match[1] ? BigInt(match[1]) : null;
  const last = match[2] ? BigInt(match[2]) : null;
  const length = BigInt(size);
  if (first === null) {
    if (last === null || last === 0n) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Number(last >= length ? 0n : length - last), end: size - 1 };
  }
  if (first >= length || (last !== null && last < first)) return { kind: "unsatisfiable" };
  return { kind: "partial", start: Number(first), end: last === null || last >= length ? size - 1 : Number(last) };
}
