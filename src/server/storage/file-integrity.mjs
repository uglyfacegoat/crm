export const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[1-9][0-9]*\.(pdf|jpg|png|webp|docx|xlsx|webm|m4a|mp3|wav)$/;

export class StoredFileIntegrityError extends Error {
  constructor() {
    super("Stored file does not match its recorded size or checksum.");
    this.name = "StoredFileIntegrityError";
  }
}

/** @param {string} key */
export function validateStorageKey(key) {
  if (!STORAGE_KEY.test(key)) throw new Error("Invalid document storage key.");
}

/** @param {{sizeBytes: number, sha256: string}} expected @param {number} maxBytes */
export function validateFileExpectation(expected, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("Invalid file read limit.");
  if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes <= 0 || expected.sizeBytes > maxBytes || !/^[0-9a-f]{64}$/.test(expected.sha256)) {
    throw new StoredFileIntegrityError();
  }
}
