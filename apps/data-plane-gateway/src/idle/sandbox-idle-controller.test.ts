import { createMutableClock, createManualScheduler } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxPresenceStore } from "../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { LocalSandboxIdleController } from "./sandbox-idle-controller.js";

describe("LocalSandboxIdleController", () => {
  it("reschedules the idle deadline when presence is touched", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    let disposeCount = 0;

    const controller = new LocalSandboxIdleController(
      {
        sandboxInstanceId: "sbi_idle",
        ownerLeaseId: "dtl_idle",
        timeoutMs: 5_000,
        disconnectGraceMs: 1_000,
        clock,
        scheduler,
        ownerStore,
        presenceStore,
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

    clock.advanceMs(2_000);
    expect(scheduler.runDue()).toBe(0);
    expect(scheduler.pendingCount()).toBe(1);
    expect(disposeCount).toBe(0);

    clock.advanceMs(3_000);
    expect(scheduler.runDue()).toBe(1);
    expect(scheduler.pendingCount()).toBe(1);
    expect(disposeCount).toBe(0);
  });

  it("owns disconnect grace timing before disposal", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    let disposeCount = 0;

    const controller = new LocalSandboxIdleController(
      {
        sandboxInstanceId: "sbi_disconnect",
        ownerLeaseId: "dtl_disconnect",
        timeoutMs: 5_000,
        disconnectGraceMs: 1_000,
        clock,
        scheduler,
        ownerStore,
        presenceStore,
      },
      () => {
        disposeCount += 1;
      },
    );

    controller.start({
      nowMs: clock.nowMs(),
    });
    controller.handleBootstrapDisconnect({
      nowMs: clock.nowMs(),
    });

    clock.advanceMs(999);
    expect(scheduler.runDue()).toBe(0);
    expect(disposeCount).toBe(0);

    clock.advanceMs(1);
    expect(scheduler.runDue()).toBe(1);
    expect(scheduler.pendingCount()).toBe(0);
    expect(disposeCount).toBe(1);
  });
});
