import postgres from "postgres";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";

export async function setFileWriteMode({ databaseUrl, mode, onWaiting = () => {} }) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!["pause", "resume", "status", "inspect"].includes(mode)) throw new Error("Mode must be pause, resume, status, or inspect.");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
  try {
    const connection = await sql.reserve();
    try {
      await connection`SET statement_timeout = '120000ms'`;
      if (mode === "status") {
        const [current] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
        if (current?.accepting === false) await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
        try {
          const [state] = await connection`SELECT accepting, changed_at FROM file_write_control WHERE id = true`;
          const [{ pending }] = await connection`SELECT count(*)::integer AS pending FROM file_write_operations`;
          return { accepting: state?.accepting === true, changedAt: state?.changed_at ?? null, pending, drained: current?.accepting === false && state?.accepting === false && pending === 0 };
        } finally {
          if (current?.accepting === false) await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
        }
      }
      if (mode === "inspect") {
        await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
        try {
          const [state] = await connection`SELECT accepting, changed_at FROM file_write_control WHERE id = true`;
          if (state?.accepting !== false) throw new Error("Pause file writes before inspecting unresolved operations.");
          const [{ pending }] = await connection`SELECT count(*)::integer AS pending FROM file_write_operations`;
          const operations = await connection`SELECT id, started_at, storage_keys FROM file_write_operations ORDER BY started_at, id LIMIT 100`;
          return { accepting: false, changedAt: state.changed_at, pending, drained: pending === 0,
            operations: operations.map(({ id, started_at, storage_keys }) => ({ id, startedAt: started_at, storageKeys: storage_keys })),
            truncated: pending > operations.length };
        } finally {
          await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
        }
      }
      if (mode === "pause") {
        await connection`UPDATE file_write_control SET accepting = false, changed_at = now() WHERE id = true`;
        onWaiting();
      }
      await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      try {
        const [{ pending }] = await connection`SELECT count(*)::integer AS pending FROM file_write_operations`;
        if (mode === "resume" && pending > 0) throw new Error(`Cannot resume: ${pending} unresolved file write operation(s).`);
        if (mode === "resume") await connection`UPDATE file_write_control SET accepting = true, changed_at = now() WHERE id = true`;
        const [state] = await connection`SELECT accepting, changed_at FROM file_write_control WHERE id = true`;
        return { accepting: state?.accepting === true, changedAt: state?.changed_at ?? null, pending, drained: state?.accepting === false && pending === 0 };
      } finally {
        await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      }
    } finally {
      connection.release();
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("/file-write-drain.mjs")) {
  const result = await setFileWriteMode({ databaseUrl: process.env.DATABASE_URL, mode: process.argv[2] });
  console.log(JSON.stringify(result));
  if (process.argv[2] === "pause" && !result.drained) process.exitCode = 2;
}
