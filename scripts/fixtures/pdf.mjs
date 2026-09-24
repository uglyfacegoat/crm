import { readFileSync } from "node:fs";

// Generated once with pdf-lib; comments and trailing whitespace leave the xref offsets intact.
const base = readFileSync(new URL("./minimal.pdf", import.meta.url));
const eofOffset = base.lastIndexOf("%%EOF");
if (eofOffset < 0) throw new Error("PDF test fixture has no EOF marker.");
const startxrefOffset = base.lastIndexOf("startxref", eofOffset);
if (startxrefOffset < 0) throw new Error("PDF test fixture has no xref marker.");
const beforeStartxref = base.subarray(0, startxrefOffset);
const beforeEof = base.subarray(startxrefOffset, eofOffset);
const afterEof = base.subarray(eofOffset);

export function pdfFixture(label = "fixture", totalBytes) {
  if (!/^[\x20-\x7e]{1,120}$/.test(label)) throw new Error("PDF fixture label must be printable ASCII.");
  const comment = Buffer.from(`% ${label}\n`, "ascii");
  const minimum = beforeStartxref.length + beforeEof.length + comment.length + afterEof.length;
  if (totalBytes !== undefined && (!Number.isSafeInteger(totalBytes) || totalBytes < minimum)) throw new Error("PDF fixture size is too small.");
  return Buffer.concat([beforeStartxref, comment, beforeEof, Buffer.alloc((totalBytes ?? minimum) - minimum, 0x20), afterEof]);
}
