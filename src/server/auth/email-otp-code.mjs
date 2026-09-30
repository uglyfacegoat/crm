import { createHmac, timingSafeEqual } from "node:crypto";

export function hashEmailOtpCode(secret, challengeId, code) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AUTH_EMAIL_OTP_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(`crm-email-otp:${challengeId}:${code}`, "utf8").digest("hex");
}

export function matchesEmailOtpCode(expectedHash, actualHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "") || !/^[a-f0-9]{64}$/.test(actualHash ?? "")) return false;
  return timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(actualHash, "hex"));
}
