import { describe, expect, it } from "vitest";

import {
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  isStableChatTransitionState,
  reduceSessionMainPanelHandoffState,
} from "./session-main-panel-handoff-state.js";

describe("session main panel handoff state", () => {
  it("returns to stable chat when CLI handoff fails and still enters restore failure explicitly", () => {
    const switchingToCli = reduceSessionMainPanelHandoffState(InitialSessionMainPanelHandoffState, {
      type: "handoff_to_cli_requested",
    });

    expect(switchingToCli).toEqual({
      transitionState: "switching_to_cli",
      errorMessage: null,
    });

    const cliEntryFailed = reduceSessionMainPanelHandoffState(switchingToCli, {
      type: "cli_handoff_failed",
      errorMessage: "codex executable missing",
    });

    expect(cliEntryFailed).toEqual({
      transitionState: "stable_chat",
      errorMessage: "codex executable missing",
    });

    const restoringChat = reduceSessionMainPanelHandoffState(cliEntryFailed, {
      type: "chat_restore_requested",
    });

    expect(restoringChat).toEqual({
      transitionState: "restoring_chat",
      errorMessage: null,
    });

    const restoreFailed = reduceSessionMainPanelHandoffState(restoringChat, {
      type: "chat_restore_failed",
      errorMessage: "Could not reconnect chat transport.",
    });

    expect(restoreFailed).toEqual({
      transitionState: "restore_failed",
      errorMessage: "Could not reconnect chat transport.",
    });

    expect(
      reduceSessionMainPanelHandoffState(restoreFailed, {
        type: "chat_restore_requested",
      }),
    ).toEqual({
      transitionState: "restoring_chat",
      errorMessage: null,
    });
  });

  it("derives CLI activity and stable-chat detection from transition state", () => {
    expect(isCliToggleActive("stable_chat")).toBe(false);
    expect(isCliToggleActive("switching_to_cli")).toBe(true);
    expect(isCliToggleActive("stable_cli")).toBe(true);
    expect(isCliToggleActive("restoring_chat")).toBe(false);
    expect(isCliToggleActive("restore_failed")).toBe(false);

    expect(isStableChatTransitionState("stable_chat")).toBe(true);
    expect(isStableChatTransitionState("switching_to_cli")).toBe(false);
    expect(isStableChatTransitionState("stable_cli")).toBe(false);
    expect(isStableChatTransitionState("restoring_chat")).toBe(false);
    expect(isStableChatTransitionState("restore_failed")).toBe(false);
  });
});
