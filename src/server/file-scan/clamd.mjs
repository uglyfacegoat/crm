import { createConnection } from "node:net";

const MAX_REPLY_BYTES = 1024;
const MAX_SCAN_BYTES = 15 * 1024 * 1024;

export class FileScanRejectedError extends Error {
  constructor() { super("File was rejected by the malware scanner."); this.name = "FileScanRejectedError"; }
}

export class FileScanUnavailableError extends Error {
  constructor() { super("Malware scanner is unavailable or returned an invalid response."); this.name = "FileScanUnavailableError"; }
}

/** @param {Record<string, string | undefined>} environment */
export function fileScanConfig(environment = process.env) {
  const mode = environment.CRM_FILE_SCAN_MODE ?? "off";
  if (mode !== "off" && mode !== "required") throw new Error("Invalid CRM_FILE_SCAN_MODE.");
  if (mode === "off") return { mode };
  const host = environment.CRM_CLAMD_HOST;
  const port = Number(environment.CRM_CLAMD_PORT ?? "3310");
  const timeoutMs = Number(environment.CRM_CLAMD_TIMEOUT_MS ?? "10000");
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new Error("Invalid CRM_CLAMD configuration.");
  }
  return { mode, host, port, timeoutMs };
}

function requestClamd(command, payload, config) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.host, port: config.port });
    let settled = false;
    let reply = Buffer.alloc(0);
    const deadline = setTimeout(() => finish(new FileScanUnavailableError()), config.timeoutMs);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    socket.on("error", () => finish(new FileScanUnavailableError()));
    socket.on("end", () => finish(new FileScanUnavailableError()));
    socket.on("data", (chunk) => {
      if (reply.length + chunk.length > MAX_REPLY_BYTES) return finish(new FileScanUnavailableError());
      reply = Buffer.concat([reply, chunk]);
      const terminator = reply.indexOf(0);
      if (terminator >= 0) finish(null, reply.subarray(0, terminator).toString("utf8"));
    });
    socket.on("connect", () => {
      socket.write(command);
      if (payload) {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(payload.length);
        socket.write(length);
        socket.write(payload);
        socket.write(Buffer.alloc(4));
      }
    });
  });
}

/** @param {Record<string, string | undefined>} environment */
export async function checkScannerAvailability(environment = process.env) {
  const config = fileScanConfig(environment);
  if (config.mode === "off") return "disabled";
  if (await requestClamd(Buffer.from("zPING\0"), null, config) !== "PONG") throw new FileScanUnavailableError();
  return "available";
}

/** @param {Buffer} buffer
 *  @param {Record<string, string | undefined>} environment */
export async function scanFileBuffer(buffer, environment = process.env) {
  const config = fileScanConfig(environment);
  if (config.mode === "off") return;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_SCAN_BYTES) throw new FileScanUnavailableError();
  const reply = await requestClamd(Buffer.from("zINSTREAM\0"), buffer, config);
  if (reply === "stream: OK") return;
  if (/^stream: .+ FOUND$/.test(reply)) throw new FileScanRejectedError();
  throw new FileScanUnavailableError();
}
