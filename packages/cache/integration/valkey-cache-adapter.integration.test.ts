import { randomUUID } from "node:crypto";

import { startValkey } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { describe, expect, test } from "vitest";

import {
  Cache,
  closeValkeyClient,
  connectValkeyClient,
  createValkeyClient,
  ValkeyCacheAdapter,
} from "../src/index.js";

describe("ValkeyCacheAdapter integration", () => {
  test("stores, deletes, and expires cache entries in real Valkey", async () => {
    const valkey = await startValkey();
    const client = createValkeyClient({
      url: valkey.url,
    });

    try {
      await connectValkeyClient(client);

      const cache = new Cache({
        adapter: new ValkeyCacheAdapter(client, `cache-integration:${randomUUID()}`),
      });

      await expect(cache.get("missing")).resolves.toBeNull();

      await cache.set("persistent", "cached-value");
      await expect(cache.get("persistent")).resolves.toBe("cached-value");

      await cache.delete("persistent");
      await expect(cache.get("persistent")).resolves.toBeNull();

      await cache.set("expiring", "temporary-value", { ttlMs: 50 });
      await expect(cache.get("expiring")).resolves.toBe("temporary-value");

      await systemSleeper.sleep(100);
      await expect(cache.get("expiring")).resolves.toBeNull();
    } finally {
      await closeValkeyClient(client);
      await valkey.stop();
    }
  }, 30_000);
});
