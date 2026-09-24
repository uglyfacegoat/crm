import { MAX_DOCUMENT_SIZE_BYTES } from "./file-limits.ts";

// Only for this browser's completed MediaRecorder output, never arbitrary uploads.
export async function finalizeRecordedVoice(recording: File, durationMs: number): Promise<File> {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Invalid recording duration.");
  if (recording.size === 0 || recording.size > MAX_DOCUMENT_SIZE_BYTES) throw new Error("Invalid recording size.");
  if (recording.type === "audio/mp4") return recording;
  if (recording.type !== "audio/webm") throw new Error("Unsupported recording format.");

  const [{ WebmFile }, { fixParsedWebmDuration }] = await Promise.all([
    import("@fix-webm-duration/parser"),
    import("@fix-webm-duration/fix"),
  ]);
  const parsed = new WebmFile(new Uint8Array(await recording.arrayBuffer()));
  const info = parsed.getSectionById(0x8538067)?.getSectionById(0x549a966);
  const scale = info?.getSectionById(0xad7b1)?.getValue();
  const existingDuration = info?.getSectionById(0x489)?.getValue();
  if (existingDuration !== undefined && Number.isFinite(existingDuration) && existingDuration > 0) return recording;
  // The library writes milliseconds and resets TimecodeScale; reject incompatible clocks.
  if (scale !== 1_000_000 || !fixParsedWebmDuration(parsed, durationMs, { logger: false })) {
    throw new Error("Cannot finalize WebM duration.");
  }
  const finalizedDuration = info?.getSectionById(0x489)?.getValue();
  if (finalizedDuration !== durationMs) throw new Error("WebM duration was not finalized.");
  const file = new File([parsed.toBlob(recording.type)], recording.name, { type: recording.type, lastModified: recording.lastModified });
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) throw new Error("Finalized recording exceeds the upload limit.");
  return file;
}
