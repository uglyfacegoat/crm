const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_IMAGE_PIXELS = 50_000_000;

export class InvalidImageError extends Error {
  constructor() { super("Image data is invalid or exceeds the pixel limit."); this.name = "InvalidImageError"; }
}

function imageFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) return "jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/** Decode every pixel of supported upload images before committing the file. */
export async function assertDecodableImage(buffer) {
  const expectedFormat = imageFormat(buffer);
  if (!expectedFormat) return;
  try {
    const { default: sharp } = await import("sharp");
    const options = { failOn: "truncated", limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true };
    const metadata = await sharp(buffer, options).metadata();
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) throw new InvalidImageError();
    await sharp(buffer, options).stats();
  } catch {
    throw new InvalidImageError();
  }
}
