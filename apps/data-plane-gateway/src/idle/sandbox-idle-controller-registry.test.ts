import { createMutableClock, createManualScheduler } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxPresenceStore } from "../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { SandboxIdleControllerRegistry } from "./sandbox-idle-controller-registry.js";
import { LocalSandboxIdleController } from "./sandbox-idle-controller.js";

describe("SandboxIdleControllerRegistry", () => {
  it("returns the existing controller for the same sandbox owner lease", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    const registry = new SandboxIdleControllerRegistry((input) => {
      return new LocalSandboxIdleController(
        {
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          presenceStore,
        },
        input.onDisposed,
      );
    });

    const firstController = registry.ensureController({
      sandboxInstanceId: "sbi_same",
      ownerLeaseId: "dtl_same",
      nowMs: clock.nowMs(),
    });
    const secondController = registry.ensureController({
      sandboxInstanceId: "sbi_same",
      ownerLeaseId: "dtl_same",
      nowMs: clock.nowMs(),
    });

    expect(secondController).toBe(firstController);
  });

  it("replaces a stale controller when a newer owner lease takes over", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    const registry = new SandboxIdleControllerRegistry((input) => {
      return new LocalSandboxIdleController(
        {
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          presenceStore,
        },
        input.onDisposed,
      );
    });

    const firstController = registry.ensureController({
      sandboxInstanceId: "sbi_replace",
      ownerLeaseId: "dtl_old",
      nowMs: clock.nowMs(),
    });
    const secondController = registry.ensureController({
      sandboxInstanceId: "sbi_replace",
      ownerLeaseId: "dtl_new",
      nowMs: clock.nowMs(),
    });

    expect(secondController).not.toBe(firstController);
    expect(registry.getController({ sandboxInstanceId: "sbi_replace" })).toBe(secondController);
  });

  it("does not dispose a newer controller when cleanup uses a stale owner fence", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const ownerStore = new InMemorySandboxOwnerStore(clock);
    const presenceStore = new InMemorySandboxPresenceStore(clock);
    const registry = new SandboxIdleControllerRegistry((input) => {
      return new LocalSandboxIdleController(
        {
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          presenceStore,
        },
        input.onDisposed,
      );
    });

    const currentController = registry.ensureController({
      sandboxInstanceId: "sbi_fenced",
      ownerLeaseId: "dtl_current",
      nowMs: clock.nowMs(),
    });

    registry.disposeController({
      sandboxInstanceId: "sbi_fenced",
      ownerLeaseId: "dtl_stale",
      reason: "owner_lost",
    });

    expect(registry.getController({ sandboxInstanceId: "sbi_fenced" })).toBe(currentController);
  });
});
