import { describe, expect, it } from "vitest";

import type { SandboxRuntimeStateSnapshot } from "../../runtime-state/sandbox-runtime-state-reader.js";
import { isSandboxBootstrapAttached } from "./wait-for-sandbox-bootstrap-attachment.js";

describe("isSandboxBootstrapAttached", () => {
  it("accepts an attached bootstrap owner before runtime readiness", () => {
    expect(
      isSandboxBootstrapAttached(
        runtimeStateSnapshot({
          ownerLeaseId: "lease_start",
          attachmentOwnerLeaseId: "lease_start",
          runtimeReady: false,
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing or stale bootstrap attachments", () => {
    expect(
      isSandboxBootstrapAttached(
        runtimeStateSnapshot({
          ownerLeaseId: "lease_start",
          attachmentOwnerLeaseId: null,
          runtimeReady: false,
        }),
      ),
    ).toBe(false);
    expect(
      isSandboxBootstrapAttached(
        runtimeStateSnapshot({
          ownerLeaseId: "lease_start",
          attachmentOwnerLeaseId: "lease_old",
          runtimeReady: true,
        }),
      ),
    ).toBe(false);
  });
});

function runtimeStateSnapshot(input: {
  ownerLeaseId: string | null;
  attachmentOwnerLeaseId: string | null;
  runtimeReady: boolean;
}): SandboxRuntimeStateSnapshot {
  return {
    ownerLeaseId: input.ownerLeaseId,
    attachment:
      input.attachmentOwnerLeaseId === null
        ? null
        : {
            sandboxInstanceId: "sbi_test",
            ownerLeaseId: input.attachmentOwnerLeaseId,
            nodeId: "dpg_test",
            sessionId: "sess_test",
            attachedAtMs: 1_000,
          },
    presence: {
      activeCount: input.attachmentOwnerLeaseId === null ? 0 : 1,
    },
    keepalive: {
      active: input.attachmentOwnerLeaseId !== null,
    },
    runtime: {
      ready: input.runtimeReady,
    },
  };
}
