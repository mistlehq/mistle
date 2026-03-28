import { describe, expect, it } from "vitest";

import { resolveSessionBootstrapState } from "./session-bootstrap-state.js";

describe("session bootstrap state", () => {
  it("fails bootstrap when config read fails", () => {
    expect(
      resolveSessionBootstrapState({
        activeConnectionKey: "sandbox_123:2026-03-28T00:00:00.000Z",
        activeThreadSyncKey: "sandbox_123:2026-03-28T00:00:00.000Z:thread_123",
        configError: new Error("Could not read config."),
        isCurrentConnectionBootstrapping: false,
        modelsError: null,
        threadSyncFailureMessage: null,
      }),
    ).toEqual({
      status: "failed",
      message: "Could not read config.",
    });
  });

  it("reports ready when models, config, and thread sync succeeded", () => {
    expect(
      resolveSessionBootstrapState({
        activeConnectionKey: "sandbox_123:2026-03-28T00:00:00.000Z",
        activeThreadSyncKey: "sandbox_123:2026-03-28T00:00:00.000Z:thread_123",
        configError: null,
        isCurrentConnectionBootstrapping: false,
        modelsError: null,
        threadSyncFailureMessage: null,
      }),
    ).toEqual({
      status: "ready",
    });
  });
});
