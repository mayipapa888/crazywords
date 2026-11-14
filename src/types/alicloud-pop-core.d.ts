declare module "@alicloud/pop-core" {
  export interface Config {
    accessKeyId: string;
    accessKeySecret: string;
    endpoint: string;
    apiVersion: string;
    opts?: object;
  }

  export class RPCClient {
    constructor(config: Config);
    request<T = unknown>(
      action: string,
      params?: Record<string, unknown>,
      options?: { method?: string },
    ): Promise<T>;
  }

  export class ROAClient {
    constructor(config: Config);
  }

  export default RPCClient;
}
