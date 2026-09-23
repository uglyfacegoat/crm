import postgres from "postgres";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";

export async function setFileWriteMode({ databaseUrl, mode, afterId, onWaiting = () => {} }) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!["pause", "resume", "status", "inspect"].includes(mode)) throw new Error("Mode must be pause, resume, status, or inspect.");
  if (afterId !== undefined && (mode !== "inspect" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(afterId))) {
    throw new Error("An operation ID cursor is valid only for inspect.");
  }
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
          const [{ transfersPending }] = await connection`SELECT count(*)::integer AS "transfersPending"
            FROM file_storage_transfers WHERE state = 'prepared'`;
          return { accepting: state?.accepting === true, changedAt: state?.changed_at ?? null,
            pending, transfersPending, drained: current?.accepting === false && state?.accepting === false
              && pending === 0 && transfersPending === 0 };
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
          const [{ transfersPending }] = await connection`SELECT count(*)::integer AS "transfersPending"
            FROM file_storage_transfers WHERE state = 'prepared'`;
          const rows = await connection`SELECT id, started_at, storage_keys FROM file_write_operations
            WHERE ${afterId ?? null}::uuid IS NULL OR id > ${afterId ?? null}::uuid ORDER BY id LIMIT 101`;
          const operations = rows.slice(0, 100);
          return { accepting: false, changedAt: state.changed_at, pending, transfersPending,
            drained: pending === 0 && transfersPending === 0,
            operations: operations.map(({ id, started_at, storage_keys }) => ({ id, startedAt: started_at, storageKeys: storage_keys })),
            nextCursor: rows.length > 100 ? operations.at(-1).id : null };
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
        const [{ transfersPending }] = await connection`SELECT count(*)::integer AS "transfersPending"
          FROM file_storage_transfers WHERE state = 'prepared'`;
        if (mode === "resume" && pending > 0) throw new Error(`Cannot resume: ${pending} unresolved file write operation(s).`);
        if (mode === "resume" && transfersPending > 0) throw new Error(`Cannot resume: ${transfersPending} unfinished file storage transfer(s).`);
        if (mode === "resume") await connection`UPDATE file_write_control SET accepting = true, changed_at = now() WHERE id = true`;
        const [state] = await connection`SELECT accepting, changed_at FROM file_write_control WHERE id = true`;
        return { accepting: state?.accepting === true, changedAt: state?.changed_at ?? null,
          pending, transfersPending, drained: state?.accepting === false && pending === 0 && transfersPending === 0 };
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
  const result = await setFileWriteMode({ databaseUrl: process.env.DATABASE_URL, mode: process.argv[2], afterId: process.argv[3] });
  console.log(JSON.stringify(result));
  if (process.argv[2] === "pause" && !result.drained) process.exitCode = 2;
}
