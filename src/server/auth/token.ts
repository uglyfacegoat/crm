import { createHash, createHmac, randomBytes } from "node:crypto";

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPrivateBucketHash(secret: string, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}
