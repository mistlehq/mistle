import { createMutableClock, createManualScheduler } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { DataPlaneApiStopSandboxClient } from "../clients/data-plane-api-stop-sandbox-client.js";
import { InMemorySandboxActivityStore } from "../runtime-state/adapters/in-memory-sandbox-activity-store.js";
import { InMemorySandboxPresenceStore } from "../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { LocalSandboxIdleController } from "./sandbox-idle-controller.js";

async function flushAsyncSchedulerWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("LocalSandboxIdleController", () => {
  it("reschedules the idle deadline when presence is touched", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const activityStore = new InMemorySandboxActivityStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const stopRequester = new DataPlaneApiStopSandboxClient({
      baseUrl: "http://127.0.0.1:1",
      serviceToken: "test-service-token",
    });
    let disposeCount = 0;
    const owner = await ownerStore.claimOwner({
      sandboxInstanceId: "sbi_idle",
      nodeId: "dpg_idle",
      sessionId: "dts_idle",
      ttlMs: 10_000,
    });

    const controller = new LocalSandboxIdleController(
      {
        sandboxInstanceId: "sbi_idle",
        ownerLeaseId: owner.leaseId,
        timeoutMs: 5_000,
        disconnectGraceMs: 1_000,
        clock,
        scheduler,
        ownerStore,
        activityStore,
        presenceStore,
        runtimeAttachmentStore,
        stopRequester,
      },
      () => {
        disposeCount += 1;
      },
    );

    controller.start({
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(3_000);
    controller.handlePresenceLeaseTouch({
      leaseId: "spl_reschedule",
      nowMs: clock.nowMs(),
    });
    await presenceStore.touchLease({
      sandboxInstanceId: "sbi_idle",
      leaseId: "spl_reschedule",
      kind: "agent",
      source: "dashboard",
      sessionId: "dts_idle",
      ttlMs: 10_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(2_000);
    expect(scheduler.runDue()).toBe(0);
    expect(scheduler.pendingCount()).toBe(1);
    expect(disposeCount).toBe(0);

    clock.advanceMs(3_000);
    expect(scheduler.runDue()).toBe(1);
    await flushAsyncSchedulerWork();
    expect(scheduler.pendingCount()).toBe(1);
    expect(disposeCount).toBe(0);
  });

  it("owns disconnect grace timing before disposal", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const activityStore = new InMemorySandboxActivityStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const stopRequester = new DataPlaneApiStopSandboxClient({
      baseUrl: "http://127.0.0.1:1",
      serviceToken: "test-service-token",
    });
    let disposeCount = 0;
    const owner = await ownerStore.claimOwner({
      sandboxInstanceId: "sbi_disconnect",
      nodeId: "dpg_disconnect",
      sessionId: "dts_disconnect",
      ttlMs: 10_000,
    });

    const controller = new LocalSandboxIdleController(
      {
        sandboxInstanceId: "sbi_disconnect",
        ownerLeaseId: owner.leaseId,
        timeoutMs: 5_000,
        disconnectGraceMs: 1_000,
        clock,
        scheduler,
        ownerStore,
        activityStore,
        presenceStore,
        runtimeAttachmentStore,
        stopRequester,
      },
      () => {
        disposeCount += 1;
      },
    );
    await runtimeAttachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_disconnect",
      ownerLeaseId: owner.leaseId,
      nodeId: "dpg_disconnect",
      sessionId: "dts_disconnect",
      attachedAtMs: clock.nowMs(),
      ttlMs: 10_000,
      nowMs: clock.nowMs(),
    });

    controller.start({
      nowMs: clock.nowMs(),
    });
    controller.handleBootstrapDisconnect({
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(999);
    expect(scheduler.runDue()).toBe(0);
    expect(disposeCount).toBe(0);
    expect(scheduler.pendingCount()).toBe(1);
  });

  it("reschedules the idle deadline when activity is touched", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const activityStore = new InMemorySandboxActivityStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const stopRequester = new DataPlaneApiStopSandboxClient({
      baseUrl: "http://127.0.0.1:1",
      serviceToken: "test-service-token",
    });
    let disposeCount = 0;
    const owner = await ownerStore.claimOwner({
      sandboxInstanceId: "sbi_activity",
      nodeId: "dpg_activity",
      sessionId: "dts_activity",
      ttlMs: 10_000,
    });

    const controller = new LocalSandboxIdleController(
      {
        sandboxInstanceId: "sbi_activity",
        ownerLeaseId: owner.leaseId,
        timeoutMs: 5_000,
        disconnectGraceMs: 1_000,
        clock,
        scheduler,
        ownerStore,
        activityStore,
        presenceStore,
        runtimeAttachmentStore,
        stopRequester,
      },
      () => {
        disposeCount += 1;
      },
    );

    controller.start({
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(3_000);
    controller.handleActivityLeaseTouch({
      leaseId: "sal_reschedule",
      nowMs: clock.nowMs(),
    });
    await activityStore.touchLease({
      sandboxInstanceId: "sbi_activity",
      leaseId: "sal_reschedule",
      kind: "agent_execution",
      source: "webhook",
      nodeId: "dpg_activity",
      ttlMs: 10_000,
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(2_000);
    expect(scheduler.runDue()).toBe(0);
    expect(scheduler.pendingCount()).toBe(1);
    expect(disposeCount).toBe(0);

    clock.advanceMs(3_000);
    expect(scheduler.runDue()).toBe(1);
    await flushAsyncSchedulerWork();
    expect(scheduler.pendingCount()).toBe(1);
    expect(disposeCount).toBe(0);
  });
});
