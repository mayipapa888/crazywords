/** 构建时注入的子路径前缀；本地开发为空字符串 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** 给绝对路径加前缀：withBase("/api/pet") → "/english/api/pet"（开发时原样返回） */
export function withBase(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
