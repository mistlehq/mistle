import { describe, expect, it } from "vitest";

import { shouldExecuteSandboxDisconnectReconciliation } from "./reconcile-sandbox-instance.js";

describe("shouldExecuteSandboxDisconnectReconciliation", () => {
  it("allows reconciliation only when the attachment is still absent and the owner is gone or unchanged", () => {
    expect(
      shouldExecuteSandboxDisconnectReconciliation({
        expectedOwnerLeaseId: "sol_disconnect",
        snapshot: {
          ownerLeaseId: "sol_disconnect",
          attachment: null,
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
        },
      }),
    ).toBe(true);

    expect(
      shouldExecuteSandboxDisconnectReconciliation({
        expectedOwnerLeaseId: "sol_disconnect",
        snapshot: {
          ownerLeaseId: null,
          attachment: null,
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects reconciliation when the attachment recovered", () => {
    expect(
      shouldExecuteSandboxDisconnectReconciliation({
        expectedOwnerLeaseId: "sol_disconnect",
        snapshot: {
          ownerLeaseId: "sol_disconnect",
          attachment: {
            sandboxInstanceId: "sbi_disconnect",
            ownerLeaseId: "sol_disconnect",
            nodeId: "dpg_disconnect",
            sessionId: "dts_disconnect",
            attachedAtMs: 1_000,
          },
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
        },
      }),
    ).toBe(false);
  });

  it("rejects reconciliation when a replacement owner took over", () => {
    expect(
      shouldExecuteSandboxDisconnectReconciliation({
        expectedOwnerLeaseId: "sol_old",
        snapshot: {
          ownerLeaseId: "sol_new",
          attachment: null,
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
        },
      }),
    ).toBe(false);
  });
});
