import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxOwnerStore } from "./adapters/in-memory-sandbox-owner-store.js";
import { StoreBackedSandboxOwnerResolver } from "./store-backed-sandbox-owner-resolver.js";

describe("StoreBackedSandboxOwnerResolver", () => {
  it("returns missing when no owner is registered", async () => {
    const store = new InMemorySandboxOwnerStore(createMutableClock(1_000));
    const resolver = new StoreBackedSandboxOwnerResolver("dpg_local", store);

    await expect(
      resolver.resolveOwner({
        sandboxInstanceId: "sbi_missing",
      }),
    ).resolves.toEqual({
      kind: "missing",
    });
  });

  it("classifies a local owner for the current node", async () => {
    const store = new InMemorySandboxOwnerStore(createMutableClock(1_000));
    const resolver = new StoreBackedSandboxOwnerResolver("dpg_local", store);
    const owner = await store.claimOwner({
      sandboxInstanceId: "sbi_abc",
      nodeId: "dpg_local",
      sessionId: "session_one",
      ttlMs: 30_000,
    });

    await expect(
      resolver.resolveOwner({
        sandboxInstanceId: "sbi_abc",
      }),
    ).resolves.toEqual({
      kind: "local",
      owner,
    });
  });

  it("classifies a remote owner for a different node", async () => {
    const store = new InMemorySandboxOwnerStore(createMutableClock(1_000));
    const resolver = new StoreBackedSandboxOwnerResolver("dpg_local", store);
    const owner = await store.claimOwner({
      sandboxInstanceId: "sbi_abc",
      nodeId: "dpg_remote",
      sessionId: "session_one",
      ttlMs: 30_000,
    });

    await expect(
      resolver.resolveOwner({
        sandboxInstanceId: "sbi_abc",
      }),
    ).resolves.toEqual({
      kind: "remote",
      owner,
    });
  });
});
