/**
 * 管理员种子脚本（幂等）。
 *
 * 用法：
 *   node --env-file=.env scripts/seed-admin.mjs
 *
 * - 用户不存在：创建 username=rockyboy-ethan / role=admin / status=active
 * - 用户已存在：校验 role/status，并在密码不匹配时重置密码
 * - 不引入额外依赖：密码哈希与 src/lib/password.ts 使用同一格式
 *   "scrypt:<saltHex>:<hashHex>"
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ADMIN_USERNAME = "rockyboy-ethan";
const ADMIN_PASSWORD = "passw0rdwyx";
const ADMIN_ROLE = "admin";
const ADMIN_STATUS = "active";

const ALGORITHM = "scrypt";
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${ALGORITHM}:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [algorithm, salt, hash] = parts;
  if (algorithm !== ALGORITHM || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  if (expected.length !== KEY_LENGTH || expected.toString("hex") !== hash.toLowerCase()) {
    return false;
  }

  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

async function main() {
  const existing = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
  });

  if (!existing) {
    const created = await prisma.user.create({
      data: {
        username: ADMIN_USERNAME,
        passwordHash: hashPassword(ADMIN_PASSWORD),
        role: ADMIN_ROLE,
        status: ADMIN_STATUS,
        // 占位会话键；正式会话在登录时生成
        sessionKey: randomBytes(24).toString("hex"),
      },
    });
    console.log(
      `[seed-admin] 已创建管理员 "${created.username}"（id=${created.id}, role=${created.role}, status=${created.status}）`,
    );
    console.log("[seed-admin] 请使用该账号登录后立即修改密码（如前端提供改密入口）。");
    return;
  }

  const changes = {};
  const notes = [];

  if (existing.role !== ADMIN_ROLE) {
    changes.role = ADMIN_ROLE;
    notes.push(`role ${existing.role} → ${ADMIN_ROLE}`);
  }
  if (existing.status !== ADMIN_STATUS) {
    changes.status = ADMIN_STATUS;
    notes.push(`status ${existing.status} → ${ADMIN_STATUS}`);
  }
  if (!verifyPassword(ADMIN_PASSWORD, existing.passwordHash)) {
    changes.passwordHash = hashPassword(ADMIN_PASSWORD);
    notes.push("密码已重置");
  }

  if (Object.keys(changes).length > 0) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: changes,
    });
    console.log(
      `[seed-admin] 已更新管理员 "${updated.username}"（id=${updated.id}）：${notes.join("，")}`,
    );
  } else {
    console.log(
      `[seed-admin] 管理员 "${existing.username}" 已存在且配置正确（id=${existing.id}, role=${existing.role}, status=${existing.status}），无需变更。`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error("[seed-admin] 执行失败：", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
