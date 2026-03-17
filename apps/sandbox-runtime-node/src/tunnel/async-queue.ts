export class AsyncQueue<T> {
  readonly #items: T[] = [];
  readonly #waiters: Array<{
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  }> = [];
  #closedError: unknown;

  push(item: T): void {
    if (this.#closedError !== undefined) {
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(item);
      return;
    }

    this.#items.push(item);
  }

  fail(error: unknown): void {
    if (this.#closedError !== undefined) {
      return;
    }

    this.#closedError = error;
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      waiter?.reject(error);
    }
  }

  async next(signal?: AbortSignal): Promise<T> {
    if (this.#items.length > 0) {
      const item = this.#items.shift();
      if (item === undefined) {
        throw new Error("queue item is required");
      }

      return item;
    }

    if (this.#closedError !== undefined) {
      throw this.#closedError;
    }

    return new Promise<T>((resolve, reject) => {
      const abortListener = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error("operation was aborted"));
      };
      const cleanup = (): void => {
        signal?.removeEventListener("abort", abortListener);
      };

      if (signal?.aborted === true) {
        abortListener();
        return;
      }

      this.#waiters.push({
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });

      signal?.addEventListener("abort", abortListener, { once: true });
    });
  }
}
