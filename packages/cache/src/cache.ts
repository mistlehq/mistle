export type CacheSetOptions = {
  ttlMs?: number;
};

export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

export class Cache {
  readonly #adapter: CacheAdapter;

  public constructor(input: { adapter: CacheAdapter }) {
    this.#adapter = input.adapter;
  }

  public async get(key: string): Promise<string | null> {
    return await this.#adapter.get(key);
  }

  public async set(key: string, value: string, options?: CacheSetOptions): Promise<void> {
    await this.#adapter.set(key, value, options);
  }

  public async delete(key: string): Promise<void> {
    await this.#adapter.delete(key);
  }
}
