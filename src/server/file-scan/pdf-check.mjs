import { PDFDocument } from "pdf-lib";

const EOF_MARKER = Buffer.from("%%EOF", "ascii");
const STARTXREF_MARKER = Buffer.from("startxref", "ascii");
const WHITESPACE = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);

export class InvalidPdfError extends Error {
  constructor() { super("PDF data is incomplete or has no readable pages."); this.name = "InvalidPdfError"; }
}

function hasCompleteTrailer(buffer) {
  const eof = buffer.lastIndexOf(EOF_MARKER);
  if (eof < 0 || eof < buffer.length - 1024) return false;
  for (let index = eof + EOF_MARKER.length; index < buffer.length; index += 1) {
    if (!WHITESPACE.has(buffer[index])) return false;
  }
  const startxref = buffer.lastIndexOf(STARTXREF_MARKER, eof);
  if (startxref < 0) return false;
  let cursor = startxref + STARTXREF_MARKER.length;
  while (cursor < eof && WHITESPACE.has(buffer[cursor])) cursor += 1;
  const offsetStart = cursor;
  while (cursor < eof && buffer[cursor] >= 0x30 && buffer[cursor] <= 0x39 && cursor - offsetStart < 16) cursor += 1;
  if (cursor === offsetStart) return false;
  const offset = Number(buffer.subarray(offsetStart, cursor).toString("ascii"));
  while (cursor < eof && WHITESPACE.has(buffer[cursor])) cursor += 1;
  if (cursor !== eof || !Number.isSafeInteger(offset) || offset >= startxref) return false;
  const xrefHeader = buffer.subarray(offset, Math.min(offset + 40, startxref)).toString("ascii");
  return xrefHeader.startsWith("xref") || /^\d+\s+\d+\s+obj\b/.test(xrefHeader);
}

/** Parse a PDF's object graph and page tree before accepting an upload. */
export async function assertReadablePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString("ascii") !== "%PDF-" || !hasCompleteTrailer(buffer)) throw new InvalidPdfError();
  try {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: false, throwOnInvalidObject: true });
    if (document.getPageCount() < 1) throw new InvalidPdfError();
  } catch {
    throw new InvalidPdfError();
  }
}
