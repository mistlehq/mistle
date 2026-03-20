import { describe, expect, it } from "vitest";

import { shouldExecuteSandboxStop } from "./stop-sandbox-instance.js";

describe("shouldExecuteSandboxStop", () => {
  it("allows an idle stop only when owner and attachment still match the expected lease", () => {
    expect(
      shouldExecuteSandboxStop({
        stopReason: "idle",
        expectedOwnerLeaseId: "dtl_idle",
        snapshot: {
          ownerLeaseId: "dtl_idle",
          attachment: {
            sandboxInstanceId: "sbi_idle",
            ownerLeaseId: "dtl_idle",
            nodeId: "dpg_idle",
            sessionId: "dts_idle",
            attachedAtMs: 1_000,
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects an idle stop after attachment loss", () => {
    expect(
      shouldExecuteSandboxStop({
        stopReason: "idle",
        expectedOwnerLeaseId: "dtl_idle",
        snapshot: {
          ownerLeaseId: "dtl_idle",
          attachment: null,
        },
      }),
    ).toBe(false);
  });

  it("rejects a disconnected stop when a replacement owner has taken over", () => {
    expect(
      shouldExecuteSandboxStop({
        stopReason: "disconnected",
        expectedOwnerLeaseId: "dtl_old",
        snapshot: {
          ownerLeaseId: "dtl_new",
          attachment: {
            sandboxInstanceId: "sbi_disconnect",
            ownerLeaseId: "dtl_new",
            nodeId: "dpg_disconnect",
            sessionId: "dts_disconnect",
            attachedAtMs: 1_000,
          },
        },
      }),
    ).toBe(false);
  });

  it("allows a disconnected stop only when no current attachment exists and the owner is gone or unchanged", () => {
    expect(
      shouldExecuteSandboxStop({
        stopReason: "disconnected",
        expectedOwnerLeaseId: "dtl_disconnect",
        snapshot: {
          ownerLeaseId: "dtl_disconnect",
          attachment: null,
        },
      }),
    ).toBe(true);

    expect(
      shouldExecuteSandboxStop({
        stopReason: "disconnected",
        expectedOwnerLeaseId: "dtl_disconnect",
        snapshot: {
          ownerLeaseId: null,
          attachment: null,
        },
      }),
    ).toBe(true);
  });
});
