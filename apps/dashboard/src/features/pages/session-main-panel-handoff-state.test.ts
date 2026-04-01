import { describe, expect, it } from "vitest";

import {
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  reduceSessionMainPanelHandoffState,
} from "./session-main-panel-handoff-state.js";

describe("session main panel handoff state", () => {
  it("returns to stable chat with inline errors for both CLI handoff and restore failures", () => {
    const switchingToCli = reduceSessionMainPanelHandoffState(InitialSessionMainPanelHandoffState, {
      type: "handoff_to_cli_requested",
    });

    expect(switchingToCli).toEqual({
      transitionState: "switching_to_cli",
      error: null,
    });

    const cliEntryFailed = reduceSessionMainPanelHandoffState(switchingToCli, {
      type: "cli_handoff_failed",
      errorMessage: "codex executable missing",
    });

    expect(cliEntryFailed).toEqual({
      transitionState: "stable_chat",
      error: {
        kind: "cli_handoff_failed",
        message: "codex executable missing",
      },
    });

    const restoringChat = reduceSessionMainPanelHandoffState(cliEntryFailed, {
      type: "chat_restore_requested",
    });

    expect(restoringChat).toEqual({
      transitionState: "restoring_chat",
      error: null,
    });

    const restoreFailed = reduceSessionMainPanelHandoffState(restoringChat, {
      type: "chat_restore_failed",
      errorMessage: "Could not reconnect chat transport.",
    });

    expect(restoreFailed).toEqual({
      transitionState: "stable_chat",
      error: {
        kind: "chat_restore_failed",
        message: "Could not reconnect chat transport.",
      },
    });

    expect(
      reduceSessionMainPanelHandoffState(restoreFailed, {
        type: "chat_restore_requested",
      }),
    ).toEqual({
      transitionState: "restoring_chat",
      error: null,
    });
  });

  it("derives CLI activity and stable-chat behavior from transition state", () => {
    expect(isCliToggleActive("stable_chat")).toBe(false);
    expect(isCliToggleActive("switching_to_cli")).toBe(true);
    expect(isCliToggleActive("stable_cli")).toBe(true);
    expect(isCliToggleActive("restoring_chat")).toBe(false);
  });
});
