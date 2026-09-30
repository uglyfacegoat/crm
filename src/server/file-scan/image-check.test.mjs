import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { assertDecodableImage, InvalidImageError } from "./image-check.mjs";

test("accepts complete PNG, JPEG and WebP images", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).toFormat(format).toBuffer();
    await assert.doesNotReject(assertDecodableImage(buffer));
  }
});

test("rejects image headers without decodable pixels", async () => {
  for (const buffer of [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    Buffer.from("RIFF0000WEBP"),
  ]) await assert.rejects(assertDecodableImage(buffer), InvalidImageError);
  await assert.doesNotReject(assertDecodableImage(Buffer.from("%PDF-1.7\n")));
});
