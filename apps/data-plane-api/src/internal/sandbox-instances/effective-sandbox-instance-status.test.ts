import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { describe, expect, it } from "vitest";

import type { SandboxRuntimeStateSnapshot } from "../../runtime-state/sandbox-runtime-state-reader.js";
import { resolveEffectiveSandboxInstanceStatus } from "./effective-sandbox-instance-status.js";

describe("resolveEffectiveSandboxInstanceStatus", () => {
  it("keeps stopped sandboxes stopped when no live runtime is attached", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STOPPED,
        runtimeStateSnapshot: null,
      }),
    ).toBe("stopped");
  });

  it("treats stopped sandboxes with a live attachment as initializing", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STOPPED,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: false }),
      }),
    ).toBe("initializing");
  });

  it("treats stopped sandboxes with a ready runtime as running", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STOPPED,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: true }),
      }),
    ).toBe("running");
  });

  it("keeps pending sandboxes pending even when no runtime is attached", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.PENDING,
        runtimeStateSnapshot: null,
      }),
    ).toBe("pending");
  });

  it("keeps failed sandboxes failed even when a ready runtime is attached", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.FAILED,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: true }),
      }),
    ).toBe("failed");
  });

  it("keeps persisted starting sandboxes starting when no runtime is attached", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STARTING,
        runtimeStateSnapshot: null,
      }),
    ).toBe("starting");
  });

  it("treats persisted starting sandboxes with bootstrap attached as initializing until ready", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STARTING,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: false }),
      }),
    ).toBe("initializing");
  });

  it("treats persisted starting sandboxes as running only when runtime readiness is true", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STARTING,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: true }),
      }),
    ).toBe("running");
  });

  it("treats persisted running sandboxes as initializing when bootstrap is attached but not ready", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.RUNNING,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: false }),
      }),
    ).toBe("initializing");
  });

  it("downgrades persisted running sandboxes to reconnecting when bootstrap is detached", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.RUNNING,
        runtimeStateSnapshot: null,
      }),
    ).toBe("reconnecting");
  });

  it("keeps persisted running sandboxes running when runtime readiness is true", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.RUNNING,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: true }),
      }),
    ).toBe("running");
  });

  it("keeps persisted reconnecting sandboxes reconnecting even when runtime readiness is true", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.RECONNECTING,
        runtimeStateSnapshot: runtimeStateSnapshot({ ready: true }),
      }),
    ).toBe("reconnecting");
  });
});

function runtimeStateSnapshot(input: { ready: boolean }): SandboxRuntimeStateSnapshot {
  return {
    ownerLeaseId: "dtl_attached",
    attachment: {
      sandboxInstanceId: "sbi_attached",
      ownerLeaseId: "dtl_attached",
      nodeId: "dpg_node",
      sessionId: "dts_session",
      attachedAtMs: 1,
    },
    keepalive: {
      active: true,
    },
    presence: {
      activeCount: 1,
    },
    runtime: {
      ready: input.ready,
    },
  };
}
