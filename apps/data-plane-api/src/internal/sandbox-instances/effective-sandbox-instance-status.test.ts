import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

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

  it("treats stopped sandboxes with a live attachment as starting", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STOPPED,
        runtimeStateSnapshot: {
          ownerLeaseId: "dtl_stopped_attached",
          attachment: {
            sandboxInstanceId: "sbi_stopped_attached",
            ownerLeaseId: "dtl_stopped_attached",
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
            ready: false,
          },
        },
      }),
    ).toBe("starting");
  });

  it("treats stopped sandboxes with a ready runtime as running", () => {
    expect(
      resolveEffectiveSandboxInstanceStatus({
        persistedStatus: SandboxInstanceStatuses.STOPPED,
        runtimeStateSnapshot: {
          ownerLeaseId: "dtl_stopped_ready",
          attachment: {
            sandboxInstanceId: "sbi_stopped_ready",
            ownerLeaseId: "dtl_stopped_ready",
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
            ready: true,
          },
        },
      }),
    ).toBe("running");
  });
});
