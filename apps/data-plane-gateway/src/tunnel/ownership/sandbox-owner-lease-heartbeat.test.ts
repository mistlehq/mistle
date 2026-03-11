import { createMutableClock, createManualScheduler } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxOwnerStore } from "./adapters/in-memory-sandbox-owner-store.js";
import { SandboxOwnerLeaseHeartbeat } from "./sandbox-owner-lease-heartbeat.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("SandboxOwnerLeaseHeartbeat", () => {
  it("renews sandbox ownership before the active lease expires", async () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const sandboxOwnerStore = new InMemorySandboxOwnerStore(clock);
    const owner = await sandboxOwnerStore.claimOwner({
      sandboxInstanceId: "sbi_test",
      nodeId: "dpg_test",
      sessionId: "dts_test",
      ttlMs: 30_000,
    });
    const heartbeat = new SandboxOwnerLeaseHeartbeat(sandboxOwnerStore, scheduler, 10_000);

    const handle = heartbeat.start({
      sandboxInstanceId: owner.sandboxInstanceId,
      leaseId: owner.leaseId,
      ttlMs: 30_000,
      onLeaseLost: () => {
        throw new Error("Expected owner lease renewal to succeed.");
      },
    });

    clock.advanceMs(10_000);
    expect(scheduler.runDue()).toBe(1);
    await flushMicrotasks();

    clock.advanceMs(25_000);

    await expect(
      sandboxOwnerStore.getOwner({
        sandboxInstanceId: owner.sandboxInstanceId,
      }),
    ).resolves.toEqual({
      ...owner,
      expiresAt: new Date(40_000),
    });

    handle.stop();
  });

  it("stops scheduling renewals when the heartbeat is stopped", async () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const sandboxOwnerStore = new InMemorySandboxOwnerStore(clock);
    const owner = await sandboxOwnerStore.claimOwner({
      sandboxInstanceId: "sbi_test",
      nodeId: "dpg_test",
      sessionId: "dts_test",
      ttlMs: 30_000,
    });
    const heartbeat = new SandboxOwnerLeaseHeartbeat(sandboxOwnerStore, scheduler, 10_000);

    const handle = heartbeat.start({
      sandboxInstanceId: owner.sandboxInstanceId,
      leaseId: owner.leaseId,
      ttlMs: 30_000,
      onLeaseLost: () => {
        throw new Error("Expected stopped heartbeat not to report lease loss.");
      },
    });

    handle.stop();

    expect(scheduler.pendingCount()).toBe(0);

    clock.advanceMs(35_000);

    await expect(
      sandboxOwnerStore.getOwner({
        sandboxInstanceId: owner.sandboxInstanceId,
      }),
    ).resolves.toBeUndefined();
  });

  it("notifies the caller when the owner lease can no longer be renewed", async () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const sandboxOwnerStore = new InMemorySandboxOwnerStore(clock);
    const owner = await sandboxOwnerStore.claimOwner({
      sandboxInstanceId: "sbi_test",
      nodeId: "dpg_test",
      sessionId: "dts_test",
      ttlMs: 30_000,
    });
    const heartbeat = new SandboxOwnerLeaseHeartbeat(sandboxOwnerStore, scheduler, 10_000);
    let leaseLostCount = 0;

    heartbeat.start({
      sandboxInstanceId: owner.sandboxInstanceId,
      leaseId: owner.leaseId,
      ttlMs: 30_000,
      onLeaseLost: () => {
        leaseLostCount += 1;
      },
    });

    await sandboxOwnerStore.releaseOwner({
      sandboxInstanceId: owner.sandboxInstanceId,
      leaseId: owner.leaseId,
    });

    clock.advanceMs(10_000);
    expect(scheduler.runDue()).toBe(1);
    await flushMicrotasks();

    expect(leaseLostCount).toBe(1);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
