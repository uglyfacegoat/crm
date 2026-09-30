import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { pdfFixture } from "../../../scripts/fixtures/pdf.mjs";
import { assertReadablePdf, InvalidPdfError } from "./pdf-check.mjs";

test("accepts a complete PDF and a file at the upload size boundary", async () => {
  await assert.doesNotReject(assertReadablePdf(pdfFixture("complete")));
  await assert.doesNotReject(assertReadablePdf(pdfFixture("boundary", 15 * 1024 * 1024)));
  const objectStreamDocument = await PDFDocument.create();
  objectStreamDocument.addPage();
  await assert.doesNotReject(assertReadablePdf(Buffer.from(await objectStreamDocument.save())));
});

test("rejects PDF header, missing EOF, truncated objects and trailing non-whitespace", async () => {
  const complete = pdfFixture("complete");
  const badXref = Buffer.from(complete);
  const xrefNumber = badXref.lastIndexOf("startxref") + "startxref\n".length;
  badXref[xrefNumber] = 0x31;
  const badPageTree = Buffer.from(complete);
  badPageTree.write("/Type /Bages", badPageTree.indexOf("/Type /Pages"), "ascii");
  for (const buffer of [
    Buffer.from("%PDF-1.7\n"),
    complete.subarray(0, complete.lastIndexOf("%%EOF")),
    complete.subarray(0, Math.floor(complete.length / 2)),
    Buffer.concat([complete, Buffer.from("broken")]),
    badXref,
    badPageTree,
  ]) await assert.rejects(assertReadablePdf(buffer), InvalidPdfError);
});
