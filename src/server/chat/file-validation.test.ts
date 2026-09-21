import assert from "node:assert/strict";
import test from "node:test";
import { DocumentFileValidationError } from "../documents/file-validation.ts";
import { validateChatAttachment, validateChatAvatar } from "./file-validation.ts";

test("accepts a WebM voice message with a valid container signature", () => {
  const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
  const result = validateChatAttachment({ filename: "voice.webm", declaredMimeType: "audio/webm", buffer });
  assert.equal(result.extension, "webm");
  assert.equal(result.mimeType, "audio/webm");
});

test("rejects an audio attachment when its signature is forged", () => {
  assert.throws(
    () => validateChatAttachment({ filename: "voice.mp3", declaredMimeType: "audio/mpeg", buffer: Buffer.from("not audio") }),
    DocumentFileValidationError,
  );
});

test("group avatars are limited to image formats", () => {
  assert.throws(
    () => validateChatAvatar({ filename: "avatar.pdf", declaredMimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") }),
    /JPG, PNG и WebP/,
  );
});
