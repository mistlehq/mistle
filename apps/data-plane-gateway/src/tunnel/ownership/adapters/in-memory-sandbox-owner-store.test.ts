import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxOwnerStore } from "./in-memory-sandbox-owner-store.js";

describe("InMemorySandboxOwnerStore", () => {
  it("claims and retrieves the current owner for a sandbox", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxOwnerStore(clock);

    const owner = await store.claimOwner({
      sandboxInstanceId: "sbi_abc",
      nodeId: "dpg_1",
      sessionId: "session_one",
      ttlMs: 30_000,
    });

    await expect(
      store.getOwner({
        sandboxInstanceId: "sbi_abc",
      }),
    ).resolves.toEqual(owner);
    expect(owner.expiresAt.getTime()).toBe(31_000);
  });

  it("rejects stale renewals and releases after a newer owner replaces the sandbox", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxOwnerStore(clock);

    const firstOwner = await store.claimOwner({
      sandboxInstanceId: "sbi_abc",
      nodeId: "dpg_1",
      sessionId: "session_one",
      ttlMs: 30_000,
    });
    const secondOwner = await store.claimOwner({
      sandboxInstanceId: "sbi_abc",
      nodeId: "dpg_1",
      sessionId: "session_two",
      ttlMs: 30_000,
    });

    await expect(
      store.renewOwnerLease({
        sandboxInstanceId: "sbi_abc",
        leaseId: firstOwner.leaseId,
        ttlMs: 45_000,
      }),
    ).resolves.toBe(false);
    await expect(
      store.releaseOwner({
        sandboxInstanceId: "sbi_abc",
        leaseId: firstOwner.leaseId,
      }),
    ).resolves.toBe(false);
    await expect(
      store.getOwner({
        sandboxInstanceId: "sbi_abc",
      }),
    ).resolves.toEqual(secondOwner);
  });

  it("expires owners and only renews the active lease", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxOwnerStore(clock);

    const owner = await store.claimOwner({
      sandboxInstanceId: "sbi_abc",
      nodeId: "dpg_1",
      sessionId: "session_one",
      ttlMs: 10_000,
    });

    clock.advanceMs(5_000);
    await expect(
      store.renewOwnerLease({
        sandboxInstanceId: "sbi_abc",
        leaseId: owner.leaseId,
        ttlMs: 10_000,
      }),
    ).resolves.toBe(true);

    clock.advanceMs(10_001);
    await expect(
      store.getOwner({
        sandboxInstanceId: "sbi_abc",
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.releaseOwner({
        sandboxInstanceId: "sbi_abc",
        leaseId: owner.leaseId,
      }),
    ).resolves.toBe(false);
  });
});
