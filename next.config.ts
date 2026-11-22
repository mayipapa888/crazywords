import type { NextConfig } from "next";

// 生产环境部署在 /english 子路径；本地开发不设置该变量，保持根路径行为。
const basePath = process.env.NEXT_BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
};

export default nextConfig;
