import { describe, expect, it } from "vitest";

import { isSandboxRuntimeReady } from "./sandbox-runtime-state-readiness.js";

describe("isSandboxRuntimeReady", () => {
  it("returns true when owner and attachment are both present and fenced to the same lease", () => {
    expect(
      isSandboxRuntimeReady({
        ownerLeaseId: "dtl_ready",
        attachment: {
          sandboxInstanceId: "sbi_ready",
          ownerLeaseId: "dtl_ready",
          nodeId: "dpg_ready",
          sessionId: "dts_ready",
          attachedAtMs: 1_000,
        },
      }),
    ).toBe(true);
  });

  it("returns false when the owner lease is missing", () => {
    expect(
      isSandboxRuntimeReady({
        ownerLeaseId: null,
        attachment: null,
      }),
    ).toBe(false);
  });

  it("returns false when the attachment is missing", () => {
    expect(
      isSandboxRuntimeReady({
        ownerLeaseId: "dtl_missing_attachment",
        attachment: null,
      }),
    ).toBe(false);
  });

  it("returns false when the attachment belongs to a different owner lease", () => {
    expect(
      isSandboxRuntimeReady({
        ownerLeaseId: "dtl_owner",
        attachment: {
          sandboxInstanceId: "sbi_fenced",
          ownerLeaseId: "dtl_other",
          nodeId: "dpg_fenced",
          sessionId: "dts_fenced",
          attachedAtMs: 1_000,
        },
      }),
    ).toBe(false);
  });
});
