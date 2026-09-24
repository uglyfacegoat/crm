import "server-only";
import { getDatabase } from "@/server/database";
import { FILE_PROCESSING_LOCK_CLASS, FILE_PROCESSING_SLOTS } from "./processing-lock-key.mjs";

export class FileProcessingBusyError extends Error {
  constructor() {
    super("Too many files are being processed. Retry shortly.");
    this.name = "FileProcessingBusyError";
  }
}

/** Cap expensive file work across web instances sharing the same PostgreSQL. */
export async function withFileProcessingSlot<T>(work: () => Promise<T>): Promise<T> {
  const connection = await getDatabase().reserve();
  let slot = 0;
  let outcome: T | undefined;
  let failure: unknown;
  let didFail = false;
  try {
    for (let candidate = 1; candidate <= FILE_PROCESSING_SLOTS; candidate += 1) {
      const [row] = await connection`SELECT pg_try_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, ${candidate}) AS locked`;
      if (row?.locked === true) { slot = candidate; break; }
    }
    if (!slot) throw new FileProcessingBusyError();
    outcome = await work();
  } catch (error) {
    didFail = true;
    failure = error;
  }

  let releaseFailure: unknown;
  try {
    if (slot) {
      const [row] = await connection`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, ${slot}) AS unlocked`;
      if (row?.unlocked !== true) throw new Error("File-processing lock was not held at release.");
    }
  } catch (error) {
    releaseFailure = error;
  } finally {
    connection.release();
  }

  if (didFail && releaseFailure) throw new AggregateError([failure, releaseFailure], "File work and lock release failed.");
  if (releaseFailure) throw releaseFailure;
  if (didFail) throw failure;
  return outcome as T;
}
