import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxPresenceStore } from "./in-memory-sandbox-presence-store.js";

describe("InMemorySandboxPresenceStore", () => {
  it("returns true while at least one active lease exists", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxPresenceStore(clock);

    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "spl_first",
      kind: "pty",
      source: "dashboard",
      sessionId: "session_first",
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });
    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "spl_second",
      kind: "agent",
      source: "cli",
      sessionId: "session_second",
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
        leaseId: "spl_first",
      }),
    ).resolves.toBe(true);
    await expect(
      store.hasAnyActiveLease({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(true);
  });

  it("returns false after the final lease is released", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxPresenceStore(clock);

    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "spl_only",
      kind: "pty",
      source: "dashboard",
      sessionId: "session_only",
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });

    await expect(
      store.releaseLease({
        sandboxInstanceId: "sbi_abc",
        leaseId: "spl_only",
      }),
    ).resolves.toBe(true);
    await expect(
      store.hasAnyActiveLease({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(false);
  });

  it("expires leases based on TTL", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxPresenceStore(clock);

    await store.touchLease({
      sandboxInstanceId: "sbi_abc",
      leaseId: "spl_expiring",
      kind: "pty",
      source: "dashboard",
      sessionId: "session_expiring",
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
