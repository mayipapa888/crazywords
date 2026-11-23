import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 密码哈希：scrypt + 每用户随机盐，输出 "scrypt:<saltHex>:<hashHex>"。
 * 不依赖第三方库；scrypt 参数使用 Node 默认值（N=16384, r=8, p=1）。
 */

const ALGORITHM = "scrypt";
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

/** 注册/改密时的统一长度校验。 */
export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${ALGORITHM}:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [algorithm, salt, hash] = parts;
  if (algorithm !== ALGORITHM || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  // 拒绝非十六进制 / 长度不符的存储值，同时避免 timingSafeEqual 抛错
  if (expected.length !== KEY_LENGTH || expected.toString("hex") !== hash.toLowerCase()) {
    return false;
  }

  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
