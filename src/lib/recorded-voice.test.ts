import assert from "node:assert/strict";
import test from "node:test";
import { WebmFile } from "@fix-webm-duration/parser";
import { finalizeRecordedVoice } from "./recorded-voice.ts";
import { MAX_DOCUMENT_SIZE_BYTES } from "./file-limits.ts";

// Minimal Segment/Info/TimecodeScale fixture; real encoded audio is covered in Chrome.
function recordingFixture(scale = 1_000_000) {
  const bytes = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x8c, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0, 0, 0]);
  bytes.writeUIntBE(scale, bytes.length - 3, 3);
  return new File([bytes], "recording.webm", { type: "audio/webm", lastModified: 1234 });
}

test("recorded WebM receives finite duration while file identity metadata is preserved", async () => {
  const original = recordingFixture();
  const finalized = await finalizeRecordedVoice(original, 3210.5);
  const parsed = new WebmFile(new Uint8Array(await finalized.arrayBuffer()));
  assert.equal(parsed.getSectionById(0x8538067)?.getSectionById(0x549a966)?.getSectionById(0x489)?.getValue(), 3210.5);
  assert.equal(finalized.name, original.name);
  assert.equal(finalized.type, original.type);
  assert.equal(finalized.lastModified, original.lastModified);
  assert.equal(await finalizeRecordedVoice(finalized, 9999), finalized, "Do not overwrite existing duration");
  assert.deepEqual(await original.arrayBuffer(), await recordingFixture().arrayBuffer(), "Do not mutate the raw draft");
});

test("invalid duration, size, type and incompatible WebM fail visibly", async () => {
  for (const duration of [0, -1, Infinity, NaN]) await assert.rejects(finalizeRecordedVoice(recordingFixture(), duration));
  await assert.rejects(finalizeRecordedVoice(new File([], "empty.webm", { type: "audio/webm" }), 1000));
  await assert.rejects(finalizeRecordedVoice(new File([new Uint8Array(MAX_DOCUMENT_SIZE_BYTES + 1)], "large.webm", { type: "audio/webm" }), 1000));
  await assert.rejects(finalizeRecordedVoice(new File(["bad"], "wrong.webm", { type: "text/plain" }), 1000));
  await assert.rejects(finalizeRecordedVoice(new File(["bad"], "corrupt.webm", { type: "audio/webm" }), 1000));
  await assert.rejects(finalizeRecordedVoice(recordingFixture(1000), 1000));
});

test("MP4 recording is not parsed or rewritten as WebM", async () => {
  const recording = new File(["mp4-fixture"], "recording.m4a", { type: "audio/mp4" });
  assert.equal(await finalizeRecordedVoice(recording, 1000), recording);
});
