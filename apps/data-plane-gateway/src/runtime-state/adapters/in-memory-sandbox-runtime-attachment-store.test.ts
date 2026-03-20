import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxRuntimeAttachmentStore } from "./in-memory-sandbox-runtime-attachment-store.js";

describe("InMemorySandboxRuntimeAttachmentStore", () => {
  it("stores and returns the active attachment", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxRuntimeAttachmentStore(clock);

    await store.upsertAttachment({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_abc",
      nodeId: "dpg_abc",
      sessionId: "dts_abc",
      attachedAtMs: 900,
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });

    await expect(
      store.getAttachment({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toEqual({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_abc",
      nodeId: "dpg_abc",
      sessionId: "dts_abc",
      attachedAtMs: 900,
    });
  });

  it("rejects stale clears after a newer owner attachment replaces the sandbox", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxRuntimeAttachmentStore(clock);

    await store.upsertAttachment({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_old",
      nodeId: "dpg_abc",
      sessionId: "dts_old",
      attachedAtMs: 900,
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });
    await store.upsertAttachment({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_new",
      nodeId: "dpg_abc",
      sessionId: "dts_new",
      attachedAtMs: 950,
      ttlMs: 30_000,
      nowMs: clock.nowMs(),
    });

    await expect(
      store.clearAttachment({
        sandboxInstanceId: "sbi_abc",
        ownerLeaseId: "dtl_old",
      }),
    ).resolves.toBe(false);
    await expect(
      store.getAttachment({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toEqual({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_new",
      nodeId: "dpg_abc",
      sessionId: "dts_new",
      attachedAtMs: 950,
    });
  });

  it("expires attachments based on TTL", async () => {
    const clock = createMutableClock(1_000);
    const store = new InMemorySandboxRuntimeAttachmentStore(clock);

    await store.upsertAttachment({
      sandboxInstanceId: "sbi_abc",
      ownerLeaseId: "dtl_abc",
      nodeId: "dpg_abc",
      sessionId: "dts_abc",
      attachedAtMs: 900,
      ttlMs: 5_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(5_001);

    await expect(
      store.getAttachment({
        sandboxInstanceId: "sbi_abc",
        nowMs: clock.nowMs(),
      }),
    ).resolves.toBeNull();
  });
});
