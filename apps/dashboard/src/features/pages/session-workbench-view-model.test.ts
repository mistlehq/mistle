import { describe, expect, it } from "vitest";

import {
  hasSessionTopAlert,
  resolveSessionWorkbenchHeaderStatusUi,
  shouldShowResumeAction,
} from "./session-workbench-view-model.js";

describe("session workbench view model", () => {
  it("maps loading read state to the loading badge regardless of lifecycle value", () => {
    expect(
      resolveSessionWorkbenchHeaderStatusUi({
        sandboxLifecycleStatus: "running",
        sandboxStatusReadState: "loading",
      }),
    ).toEqual({
      label: "Loading status",
      variant: "outline",
    });
  });

  it("maps ready read state through sandbox lifecycle badge presentation", () => {
    expect(
      resolveSessionWorkbenchHeaderStatusUi({
        sandboxLifecycleStatus: "running",
        sandboxStatusReadState: "ready",
      }),
    ).toEqual({
      label: "Running",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    });
  });

  it("shows top alerts only when one of the alert sources is present", () => {
    expect(
      hasSessionTopAlert({
        hasSandboxStatusError: false,
        lifecycleErrorMessage: null,
        reconnectMessage: null,
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      }),
    ).toBe(false);

    expect(
      hasSessionTopAlert({
        hasSandboxStatusError: false,
        lifecycleErrorMessage: null,
        reconnectMessage: "Reconnecting session.",
        sandboxFailureMessage: null,
        stoppedSessionMessage: null,
      }),
    ).toBe(true);
  });

  it("shows the resume action only when manual resume is required", () => {
    expect(shouldShowResumeAction({ requiresManualResume: true })).toBe(true);
    expect(shouldShowResumeAction({ requiresManualResume: false })).toBe(false);
  });
});
