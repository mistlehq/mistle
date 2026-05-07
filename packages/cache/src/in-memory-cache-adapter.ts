import type { CacheAdapter, CacheSetOptions } from "./cache.js";

type InMemoryCacheRecord = {
  expiresAtMs: number | null;
  value: string;
};

export class InMemoryCacheAdapter implements CacheAdapter {
  readonly #recordsByKey = new Map<string, InMemoryCacheRecord>();

  public async get(key: string): Promise<string | null> {
    const record = this.#recordsByKey.get(key);
    if (record === undefined) {
      return null;
    }

    if (record.expiresAtMs !== null && record.expiresAtMs <= Date.now()) {
      this.#recordsByKey.delete(key);
      return null;
    }

    return record.value;
  }

  public async set(key: string, value: string, options?: CacheSetOptions): Promise<void> {
    this.#recordsByKey.set(key, {
      expiresAtMs: options?.ttlMs === undefined ? null : Date.now() + options.ttlMs,
      value,
    });
  }

  public async delete(key: string): Promise<void> {
    this.#recordsByKey.delete(key);
  }
}
