import { requireUser } from "./auth";

/** @deprecated 使用 requireUser；保留别名避免遗漏引用 */
export async function getOrCreateDemoUser(req?: Request) {
  if (!req) {
    throw new Error("需要 Request 以绑定会话用户，请改用 requireUser(req)");
  }
  const { user } = await requireUser(req);
  return user;
}
