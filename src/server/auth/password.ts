import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_PARAMETERS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;
const HASH_PREFIX = "scrypt";

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMETERS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [HASH_PREFIX, SCRYPT_PARAMETERS.N, SCRYPT_PARAMETERS.r, SCRYPT_PARAMETERS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [prefix, n, r, p, saltValue, keyValue, unexpected] = encodedHash.split("$");
  if (prefix !== HASH_PREFIX || unexpected || !saltValue || !keyValue) return false;
  if (Number(n) !== SCRYPT_PARAMETERS.N || Number(r) !== SCRYPT_PARAMETERS.r || Number(p) !== SCRYPT_PARAMETERS.p) return false;

  let salt: Buffer;
  let expectedKey: Buffer;
  try {
    salt = Buffer.from(saltValue, "base64url");
    expectedKey = Buffer.from(keyValue, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) return false;

  const actualKey = await deriveKey(password, salt);
  return timingSafeEqual(actualKey, expectedKey);
}

const dummySalt = Buffer.alloc(16, 0x6d);
const dummyKey = scryptSync("crm-dummy-password", dummySalt, KEY_LENGTH, SCRYPT_PARAMETERS);
export const DUMMY_PASSWORD_HASH = [HASH_PREFIX, SCRYPT_PARAMETERS.N, SCRYPT_PARAMETERS.r, SCRYPT_PARAMETERS.p, dummySalt.toString("base64url"), dummyKey.toString("base64url")].join("$");
