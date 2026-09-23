import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "./lock-key.mjs";

export class FileWritesPausedError extends Error {
  constructor() { super("File uploads are temporarily paused."); }
}

export class FileWriteLeaseLostError extends Error {
  constructor() { super("File write lease could not be released or verified."); }
}

let gatePool;
function pool() {
  if (!gatePool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for file write leases.");
    // A separate small pool prevents an upload lease from exhausting the pool
    // used by the same request's business transaction.
    gatePool = postgres(process.env.DATABASE_URL, { max: 5, connect_timeout: 10, idle_timeout: 20 });
  }
  return gatePool;
}

/** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
export async function withFileWriteLease(work) {
  const connection = await pool().reserve();
  const operationId = randomUUID();
  let locked = false;
  let registered = false;
  let failure;
  try {
    await connection`SET statement_timeout = '30000ms'`;
    await connection`SELECT pg_advisory_lock_shared(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
    locked = true;
    const [state] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
    if (state?.accepting !== true) throw new FileWritesPausedError();
    await connection`INSERT INTO file_write_operations (id) VALUES (${operationId})`;
    registered = true;
    return await work();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      if (registered) await connection`DELETE FROM file_write_operations WHERE id = ${operationId}`;
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (locked) await connection`SELECT pg_advisory_unlock_shared(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      connection.release();
    }
    if (cleanupErrors.length) {
      if (failure) throw new AggregateError([failure, ...cleanupErrors], "File write and lease release failed.");
      throw new FileWriteLeaseLostError();
    }
  }
}

export async function closeFileWriteGate() {
  const activePool = gatePool;
  gatePool = undefined;
  if (activePool) await activePool.end();
}
