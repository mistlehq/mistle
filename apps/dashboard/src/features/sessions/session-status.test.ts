import { describe, expect, it } from "vitest";

import { resolveSessionStatus } from "./session-status.js";

describe("resolveSessionStatus", () => {
  it("returns loading while the status read is still pending", () => {
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: null,
        sandboxConnectable: null,
        isStatusLoading: true,
        isReconnecting: false,
      }),
    ).toBe("loading");
  });

  it("returns starting for pending, starting, and resuming sandbox lifecycle states", () => {
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "pending",
        sandboxConnectable: false,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("starting");
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "starting",
        sandboxConnectable: false,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("starting");
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "resuming",
        sandboxConnectable: false,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("starting");
  });

  it("distinguishes connecting from connected for running sandboxes", () => {
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "running",
        sandboxConnectable: false,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("connecting");
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "running",
        sandboxConnectable: true,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("connected");
  });

  it("returns reconnecting ahead of the base lifecycle status", () => {
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "running",
        sandboxConnectable: true,
        isStatusLoading: false,
        isReconnecting: true,
      }),
    ).toBe("reconnecting");
  });

  it("returns stopped and failed for terminal states", () => {
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "stopped",
        sandboxConnectable: false,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("stopped");
    expect(
      resolveSessionStatus({
        sandboxLifecycleStatus: "failed",
        sandboxConnectable: false,
        isStatusLoading: false,
        isReconnecting: false,
      }),
    ).toBe("failed");
  });
});
