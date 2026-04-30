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
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
          runtime: {
            ready: false,
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
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
          runtime: {
            ready: false,
          },
        },
      }),
    ).toBe(false);
  });

  it("allows user-requested setup-check stops without an owner lease fence", () => {
    expect(
      shouldExecuteSandboxStop({
        stopReason: "user",
        snapshot: {
          ownerLeaseId: null,
          attachment: null,
          presence: {
            activeCount: 0,
          },
          keepalive: {
            active: false,
          },
          runtime: {
            ready: false,
          },
        },
      }),
    ).toBe(true);
  });
});
