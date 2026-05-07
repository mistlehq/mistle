import { describe, expect, it } from "vitest";

import { Cache } from "./cache.js";
import { InMemoryCacheAdapter } from "./in-memory-cache-adapter.js";

describe("Cache", () => {
  it("stores, reads, and deletes values through its adapter", async () => {
    const cache = new Cache({
      adapter: new InMemoryCacheAdapter(),
    });

    await expect(cache.get("session-token")).resolves.toBeNull();

    await cache.set("session-token", "token-value");

    await expect(cache.get("session-token")).resolves.toBe("token-value");

    await cache.delete("session-token");

    await expect(cache.get("session-token")).resolves.toBeNull();
  });
});
