import { Unzip, UnzipInflate, unzipSync } from "fflate";

const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_NESTED_DEPTH = 4;

function inspectZip(buffer, options, budget, depth) {
  if (depth > MAX_NESTED_DEPTH) return false;
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return false;
  try {
    const entries = new Map();
    let declaredTotal = 0;
    unzipSync(buffer, { filter: (file) => {
      if (budget.entries + entries.size >= MAX_ENTRIES || entries.has(file.name)
        || !Number.isSafeInteger(file.originalSize) || file.originalSize < 0
        || file.originalSize > MAX_ENTRY_BYTES
        || (file.compression !== 0 && file.compression !== 8)) throw new Error("Invalid ZIP entry.");
      declaredTotal += file.originalSize;
      if (budget.expanded + declaredTotal > MAX_EXPANDED_BYTES) throw new Error("ZIP expansion limit exceeded.");
      entries.set(file.name, file.originalSize);
      return false;
    } });
    if (entries.size === 0) return false;
    if (options.requiredPrefix && (!entries.has("[Content_Types].xml")
      || ![...entries.keys()].some((name) => name.startsWith(options.requiredPrefix)))) return false;
    budget.entries += entries.size;

    let completed = 0;
    const seen = new Set();
    const unzipper = new Unzip((file) => {
      if (!entries.has(file.name) || seen.has(file.name)) throw new Error("ZIP directory mismatch.");
      seen.add(file.name);
      let actualSize = 0;
      let prefix = Buffer.alloc(0);
      let nestedChunks = null;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        actualSize += chunk.length;
        budget.expanded += chunk.length;
        if (actualSize > MAX_ENTRY_BYTES || budget.expanded > MAX_EXPANDED_BYTES) throw new Error("ZIP expansion limit exceeded.");
        if (nestedChunks) nestedChunks.push(Buffer.from(chunk));
        else if (prefix !== null) {
          prefix = Buffer.concat([prefix, Buffer.from(chunk)]);
          if (prefix.length >= 4) {
            nestedChunks = prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? [prefix] : null;
            prefix = null;
          }
        }
        if (final) {
          if (actualSize !== entries.get(file.name)) throw new Error("ZIP entry size mismatch.");
          if (nestedChunks && !inspectZip(Buffer.concat(nestedChunks), {}, budget, depth + 1)) {
            throw new Error("Invalid nested ZIP.");
          }
          completed++;
        }
      };
      file.start();
    });
    unzipper.register(UnzipInflate);
    // Small input chunks bound memory in a single inflation callback even
    // when an entry supplies forged size metadata.
    for (let offset = 0; offset < buffer.length; offset += 4096) {
      unzipper.push(buffer.subarray(offset, offset + 4096), offset + 4096 >= buffer.length);
    }
    return completed === entries.size;
  } catch {
    return false;
  }
}

/**
 * Validate a ZIP container without keeping expanded files in memory. The
 * central-directory check rejects ordinary bombs before decompression; the
 * streamed pass also catches archives that lie about their expanded sizes.
 * @param {Buffer} buffer
 * @param {{ requiredPrefix?: string }} options
 */
export function hasBoundedZip(buffer, options = {}) {
  return inspectZip(buffer, options, { entries: 0, expanded: 0 }, 0);
}
