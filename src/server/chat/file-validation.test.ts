import assert from "node:assert/strict";
import test from "node:test";
import { DocumentFileValidationError } from "../documents/file-validation.ts";
import { MAX_CHAT_AVATAR_BYTES, validateChatAttachment, validateChatAvatar } from "./file-validation.ts";

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

test("rejects an audio attachment when the declared MIME does not match", () => {
  assert.throws(
    () => validateChatAttachment({ filename: "voice.webm", declaredMimeType: "application/pdf", buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]) }),
    /Содержимое аудиофайла не соответствует/,
  );
});

test("group avatars are limited to image formats", () => {
  assert.throws(
    () => validateChatAvatar({ filename: "avatar.pdf", declaredMimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") }),
    /JPG, PNG и WebP/,
  );
});

test("group avatars reject files above their smaller limit", () => {
  const oversized = Buffer.alloc(MAX_CHAT_AVATAR_BYTES + 1);
  oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.throws(
    () => validateChatAvatar({ filename: "avatar.png", declaredMimeType: "image/png", buffer: oversized }),
    /3 МБ/,
  );
});
