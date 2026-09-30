import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";

export async function runProcess(command, argumentsList, options = {}) {
  await executeProcess(command, argumentsList, options, false);
}

export async function captureProcess(command, argumentsList, options = {}) {
  return await executeProcess(command, argumentsList, options, true);
}

async function executeProcess(command, argumentsList, options, capture) {
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("Backup process timeout must be a positive timer-safe integer.");
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: options.cwd,
      env: options.environment,
      stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
    });
    let stdout = "";
    let failure;
    let killTimer;
    const terminate = (error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const timeout = setTimeout(() => terminate(new Error(`${command} exceeded its ${timeoutMs} ms time limit.`)), timeoutMs);
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (failure) return;
      if (stdout.length + chunk.length > 4_000_000) {
        terminate(new Error(`${command} output exceeds the capture limit.`));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.slice(0, Math.max(0, 16_384 - stderr.length));
    });
    child.once("error", (error) => { failure ??= error; });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (failure) {
        reject(failure);
        return;
      }
      if (exitCode === 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim().slice(0, 2_000);
      reject(new Error(`${command} failed (${signal ?? exitCode})${detail ? `: ${detail}` : ""}`));
    });
  });
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
