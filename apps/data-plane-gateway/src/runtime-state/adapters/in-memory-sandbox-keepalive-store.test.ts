import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxKeepaliveStore } from "./in-memory-sandbox-keepalive-store.js";

describe("InMemorySandboxKeepaliveStore", () => {
  it("returns an active summary while at least one keepalive exists", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxKeepaliveStore(clock);

    await store.touchKeepalive({
      sandboxInstanceId: "sbi_abc",
      keepaliveId: "skp_first",
      source: "codex",
      externalSubjectId: "turn_123",
      metadata: {
        threadId: "thr_123",
      },
      nodeId: "dpg_123",
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: null,
      }),
    ).resolves.toEqual({ active: true });
    await expect(
      store.releaseKeepalive({
        sandboxInstanceId: "sbi_abc",
        keepaliveId: "skp_first",
      }),
    ).resolves.toBe(true);
    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: null,
      }),
    ).resolves.toEqual({ active: false });
  });

  it("renews existing keepalives and rejects renewing unknown keepalives", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxKeepaliveStore(clock);

    await store.touchKeepalive({
      sandboxInstanceId: "sbi_abc",
      keepaliveId: "skp_known",
      source: "codex",
      nodeId: "dpg_123",
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(4_000);

    await expect(
      store.renewKeepalive({
        sandboxInstanceId: "sbi_abc",
        keepaliveId: "skp_known",
        ttlMs: 5_000,
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(true);

    clock.advanceMs(2_000);

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: null,
      }),
    ).resolves.toEqual({ active: true });
    await expect(
      store.renewKeepalive({
        sandboxInstanceId: "sbi_abc",
        keepaliveId: "skp_missing",
        ttlMs: 5_000,
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBe(false);
  });

  it("expires keepalives based on TTL", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxKeepaliveStore(clock);

    await store.touchKeepalive({
      sandboxInstanceId: "sbi_abc",
      keepaliveId: "skp_expiring",
      source: "codex",
      nodeId: "dpg_123",
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(5_001);

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: null,
      }),
    ).resolves.toEqual({ active: false });
  });

  it("summarizes owner-fenced keepalive state independently of legacy keepalive records", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxKeepaliveStore(clock);

    await store.replaceStateForOwner({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_owner",
      nodeId: "dpg_123",
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
      active: true,
    });

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: "dtl_owner",
      }),
    ).resolves.toEqual({ active: true });
    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: "dtl_other",
      }),
    ).resolves.toEqual({ active: false });

    await store.replaceStateForOwner({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_owner_next",
      nodeId: "dpg_123",
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
      active: false,
    });

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
        ownerLeaseId: "dtl_owner_next",
      }),
    ).resolves.toEqual({ active: false });
  });
});
