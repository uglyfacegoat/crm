import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertReadableAudio, InvalidAudioError } from "./audio-check.mjs";

for (const extension of ["wav", "mp3", "m4a", "webm"]) {
  test(`accepts a complete ${extension} recording and rejects its bare header`, async () => {
    const buffer = await readFile(new URL(`./fixtures/tone.${extension}`, import.meta.url));
    await assert.doesNotReject(assertReadableAudio(buffer, extension));
    await assert.rejects(assertReadableAudio(buffer.subarray(0, extension === "wav" ? 12 : extension === "m4a" ? 12 : extension === "mp3" ? 3 : 4), extension), InvalidAudioError);
  });
}

test("rejects a recording with a different container than its extension", async () => {
  const buffer = await readFile(new URL("./fixtures/tone.wav", import.meta.url));
  await assert.rejects(assertReadableAudio(buffer, "mp3"), InvalidAudioError);
});
