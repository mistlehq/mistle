import { describe, expect, it } from "vitest";

import { isSandboxRuntimeReady } from "./sandbox-runtime-state-readiness.js";

describe("isSandboxRuntimeReady", () => {
  it("returns true when owner, attachment, and runtime readiness are all present", () => {
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
        presence: {
          activeCount: 0,
        },
        keepalive: {
          active: false,
        },
        runtime: {
          ready: true,
        },
      }),
    ).toBe(true);
  });

  it("returns false when the owner lease is missing", () => {
    expect(
      isSandboxRuntimeReady({
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
      }),
    ).toBe(false);
  });

  it("returns false when the attachment is missing", () => {
    expect(
      isSandboxRuntimeReady({
        ownerLeaseId: "dtl_missing_attachment",
        attachment: null,
        presence: {
          activeCount: 0,
        },
        keepalive: {
          active: false,
        },
        runtime: {
          ready: true,
        },
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
        presence: {
          activeCount: 0,
        },
        keepalive: {
          active: false,
        },
        runtime: {
          ready: true,
        },
      }),
    ).toBe(false);
  });

  it("returns false when the runtime is not ready yet", () => {
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
        presence: {
          activeCount: 0,
        },
        keepalive: {
          active: false,
        },
        runtime: {
          ready: false,
        },
      }),
    ).toBe(false);
  });
});
