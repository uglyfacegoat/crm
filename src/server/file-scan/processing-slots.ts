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
export async function acquireFileProcessingSlot(): Promise<() => Promise<void>> {
  const connection = await getDatabase().reserve();
  let slot = 0;
  try {
    for (let candidate = 1; candidate <= FILE_PROCESSING_SLOTS; candidate += 1) {
      const [row] = await connection`SELECT pg_try_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, ${candidate}) AS locked`;
      if (row?.locked === true) { slot = candidate; break; }
    }
    if (!slot) throw new FileProcessingBusyError();
  } catch (error) {
    connection.release();
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      const [row] = await connection`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, ${slot}) AS unlocked`;
      if (row?.unlocked !== true) throw new Error("File-processing lock was not held at release.");
    } finally {
      connection.release();
    }
  };
}

export async function withFileProcessingSlot<T>(work: () => Promise<T>): Promise<T> {
  const release = await acquireFileProcessingSlot();
  let outcome: T | undefined;
  let failure: unknown;
  let didFail = false;
  try {
    outcome = await work();
  } catch (error) {
    didFail = true;
    failure = error;
  }

  let releaseFailure: unknown;
  try { await release(); } catch (error) { releaseFailure = error; }

  if (didFail && releaseFailure) throw new AggregateError([failure, releaseFailure], "File work and lock release failed.");
  if (releaseFailure) throw releaseFailure;
  if (didFail) throw failure;
  return outcome as T;
}

/** Keep the shared permit until the client consumes or cancels the response. */
export async function withFileProcessingResponse(
  work: () => Promise<{ body: Buffer; init: ResponseInit } | { response: Response }>,
): Promise<Response> {
  const release = await acquireFileProcessingSlot();
  try {
    const result = await work();
    if ("response" in result) {
      await release();
      return result.response;
    }
    const { body, init } = result;
    let offset = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      await release();
    };
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        timer = setTimeout(() => {
          controller.error(new Error("File response exceeded the transfer time limit."));
          void finish().catch(() => console.error(JSON.stringify({ operation: "file_response", category: "slot_release_failed" })));
        }, 5 * 60 * 1000);
        timer.unref?.();
      },
      async pull(controller) {
        if (offset >= body.length) {
          await finish();
          controller.close();
          return;
        }
        const end = Math.min(offset + 64 * 1024, body.length);
        controller.enqueue(new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset + offset, end - offset));
        offset = end;
      },
      async cancel() { await finish(); },
    }, { highWaterMark: 1 });
    return new Response(stream, init);
  } catch (error) {
    try { await release(); } catch (releaseError) {
      throw new AggregateError([error, releaseError], "File response and lock release failed.");
    }
    throw error;
  }
}
