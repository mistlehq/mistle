import type { CacheAdapter, CacheSetOptions } from "./cache.js";
import type { ValkeyClient } from "./valkey-client.js";

export class ValkeyCacheAdapter implements CacheAdapter {
  public constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

  public async get(key: string): Promise<string | null> {
    return await this.client.get(this.buildKey(key));
  }

  public async set(key: string, value: string, options?: CacheSetOptions): Promise<void> {
    if (options?.ttlMs === undefined) {
      await this.client.set(this.buildKey(key), value);
      return;
    }

    await this.client.set(this.buildKey(key), value, {
      PX: options.ttlMs,
    });
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(this.buildKey(key));
  }

  private buildKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }
}
