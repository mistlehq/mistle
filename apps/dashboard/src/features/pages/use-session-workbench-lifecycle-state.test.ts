import { describe, expect, it } from "vitest";

import { resolveInitialEntryStartupState } from "./use-session-workbench-lifecycle-state.js";

describe("resolveInitialEntryStartupState", () => {
  it("does not show a startup state when chat is already ready on mount", () => {
    expect(
      resolveInitialEntryStartupState({
        mainPanelTransitionState: "stable_chat",
        rawSandboxStatus: null,
        sandboxStatusReadState: "loading",
        sessionSnapshot: {
          activeThreadId: "thread_test",
          activeThreadCwd: "/root",
          connectedAtIso: "2026-04-21T00:00:00.000Z",
          providerThreadId: null,
          sandboxInstanceId: "sbi_test",
        },
      }),
    ).toBeNull();
  });

  it("still shows the loading startup state before chat exists", () => {
    expect(
      resolveInitialEntryStartupState({
        mainPanelTransitionState: "stable_chat",
        rawSandboxStatus: null,
        sandboxStatusReadState: "loading",
        sessionSnapshot: null,
      }),
    ).toBe("loading_status");
  });
});
