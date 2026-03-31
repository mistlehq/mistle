import { describe, expect, it } from "vitest";

import {
  canRenderChatComposer,
  InitialSessionMainPanelHandoffState,
  isCliToggleActive,
  reduceSessionMainPanelHandoffState,
  shouldLifecycleAutoAttachChat,
} from "./session-main-panel-handoff-state.js";

describe("session main panel handoff state", () => {
  it("moves through the CLI entry and restore failure states explicitly", () => {
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
      transitionState: "cli_entry_failed",
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

  it("derives CLI activity, chat composer rendering, and lifecycle auto-attach from transition state", () => {
    expect(isCliToggleActive("stable_chat")).toBe(false);
    expect(isCliToggleActive("switching_to_cli")).toBe(true);
    expect(isCliToggleActive("cli_entry_failed")).toBe(true);
    expect(isCliToggleActive("stable_cli")).toBe(true);
    expect(isCliToggleActive("restoring_chat")).toBe(false);
    expect(isCliToggleActive("restore_failed")).toBe(false);

    expect(canRenderChatComposer("stable_chat")).toBe(true);
    expect(canRenderChatComposer("stable_cli")).toBe(false);
    expect(canRenderChatComposer("cli_entry_failed")).toBe(false);
    expect(canRenderChatComposer("restoring_chat")).toBe(false);
    expect(canRenderChatComposer("restore_failed")).toBe(false);

    expect(shouldLifecycleAutoAttachChat("stable_chat")).toBe(true);
    expect(shouldLifecycleAutoAttachChat("switching_to_cli")).toBe(false);
    expect(shouldLifecycleAutoAttachChat("cli_entry_failed")).toBe(false);
    expect(shouldLifecycleAutoAttachChat("stable_cli")).toBe(false);
    expect(shouldLifecycleAutoAttachChat("restoring_chat")).toBe(false);
    expect(shouldLifecycleAutoAttachChat("restore_failed")).toBe(false);
  });
});
