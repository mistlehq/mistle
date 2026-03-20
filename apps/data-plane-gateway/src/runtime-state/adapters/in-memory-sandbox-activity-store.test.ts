import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxActivityStore } from "./in-memory-sandbox-activity-store.js";

describe("InMemorySandboxActivityStore", () => {
  it("returns true while at least one active lease exists", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxActivityStore(clock);

    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "sal_first",
      kind: "agent_execution",
      source: "codex",
      externalExecutionId: "turn_123",
      metadata: {
        threadId: "thr_123",
      },
      nodeId: "dpg_123",
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });

    await expect(
      store.hasAnyActiveLease({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(true);
    await expect(
      store.releaseLease({
        sandboxInstanceId: "sbi_abc",
        leaseId: "sal_first",
      }),
    ).resolves.toBe(true);
    await expect(
      store.hasAnyActiveLease({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(false);
  });

  it("renews existing leases and rejects renewing unknown leases", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxActivityStore(clock);

    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "sal_known",
      kind: "agent_execution",
      source: "codex",
      nodeId: "dpg_123",
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(4_000);

    await expect(
      store.renewLease({
        sandboxInstanceId: "sbi_abc",
        leaseId: "sal_known",
        ttlMs: 5_000,
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(true);

    clock.advanceMs(2_000);

    await expect(
      store.hasAnyActiveLease({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(true);
    await expect(
      store.renewLease({
        sandboxInstanceId: "sbi_abc",
        leaseId: "sal_missing",
        ttlMs: 5_000,
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(false);
  });

  it("expires leases based on TTL", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxActivityStore(clock);

    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "sal_expiring",
      kind: "agent_execution",
      source: "codex",
      nodeId: "dpg_123",
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(5_001);

    await expect(
      store.hasAnyActiveLease({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(false);
  });
});
