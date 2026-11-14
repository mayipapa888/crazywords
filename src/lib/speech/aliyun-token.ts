import RPCClient from "@alicloud/pop-core";

type CachedToken = { id: string; expireTime: number };

const cache = new Map<string, CachedToken>();

/**
 * 通过 AccessKey 调用 CreateToken（nls-meta）。
 * Token 在 ExpireTime 前复用，到期前 60s 刷新。
 */
export async function getNlsToken(opts: {
  accessKeyId: string;
  accessKeySecret: string;
  region?: string;
}): Promise<string> {
  const region = opts.region || process.env.NLS_REGION || "cn-shanghai";
  const cacheKey = `${opts.accessKeyId}:${region}`;
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(cacheKey);
  if (hit && hit.expireTime - 60 > now) {
    return hit.id;
  }

  const client = new RPCClient({
    accessKeyId: opts.accessKeyId,
    accessKeySecret: opts.accessKeySecret,
    endpoint: `https://nls-meta.${region}.aliyuncs.com`,
    apiVersion: "2019-02-28",
  });

  let result: { Token?: { Id?: string; ExpireTime?: number } };
  try {
    result = (await client.request("CreateToken", {}, { method: "POST" })) as {
      Token?: { Id?: string; ExpireTime?: number };
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`阿里云 CreateToken 失败：${msg}`);
  }

  const id = result.Token?.Id;
  const expireTime = result.Token?.ExpireTime;
  if (!id || !expireTime) {
    throw new Error("阿里云 CreateToken 响应缺少 Token.Id / ExpireTime");
  }

  cache.set(cacheKey, { id, expireTime });
  return id;
}
