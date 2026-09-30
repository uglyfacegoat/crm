import { parseBuffer } from "music-metadata";

const CONTAINERS = {
  wav: (value) => value === "WAVE",
  mp3: (value) => value === "MPEG",
  m4a: (value) => /^(M4A|MP4|MPEG-4)(\/|$)/.test(value),
  webm: (value) => value === "EBML/webm",
};

export class InvalidAudioError extends Error {
  constructor() { super("Audio data has no readable track or does not match its declared format."); this.name = "InvalidAudioError"; }
}

/** Inspect a buffered chat recording's track and duration before storage. */
export async function assertReadableAudio(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || !Object.hasOwn(CONTAINERS, extension)) throw new InvalidAudioError();
  try {
    const { format } = await parseBuffer(buffer, undefined, { duration: true, skipCovers: true });
    if (!CONTAINERS[extension](format.container ?? "") || format.hasAudio !== true || format.hasVideo === true
      || !format.codec || !Number.isFinite(format.sampleRate) || format.sampleRate <= 0
      || !Number.isSafeInteger(format.numberOfChannels) || format.numberOfChannels <= 0
      || !Number.isFinite(format.duration) || format.duration <= 0) throw new InvalidAudioError();
  } catch {
    throw new InvalidAudioError();
  }
}
