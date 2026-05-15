import type {
  SessionTerminalContentInset,
  SessionTerminalThemeMode,
} from "./session-terminal-surface.js";
import type { SessionMainPanelHandoffResult } from "./use-session-main-panel-handoff.js";

type SessionWorkbenchPrimaryPanelState = {
  canEnterCli: boolean;
  cliRuntimeDisplayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  cliTerminalThemeMode: SessionTerminalThemeMode;
  disabledReason: string | null;
  enterCliMode: () => Promise<void>;
  error: SessionMainPanelHandoffResult["error"];
  exitCliMode: () => Promise<void>;
  isCliToggleActive: boolean;
  showsChatComposer: boolean;
  transitionState: SessionMainPanelHandoffResult["transitionState"];
};

function resolveEnterCliDisabledReason(input: {
  canConnect: boolean;
  cliRuntimeDisplayName: string;
  hasSessionSnapshot: boolean;
  sandboxInstanceId: string | null;
  stoppedSessionMessage: string | null;
  transitionState: SessionMainPanelHandoffResult["transitionState"];
}): string | null {
  if (input.sandboxInstanceId === null) {
    return "Session id is required.";
  }

  if (!input.hasSessionSnapshot) {
    return "TUI is available after the session is connected.";
  }

  if (!input.canConnect) {
    return input.stoppedSessionMessage ?? "TUI is available only when the sandbox is running.";
  }

  if (input.transitionState !== "stable_chat") {
    return `Finish the current primary-panel transition before opening ${input.cliRuntimeDisplayName} TUI.`;
  }

  return null;
}

export function resolveSessionWorkbenchPrimaryPanelState(input: {
  canConnect: boolean;
  cliRuntimeDisplayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  handoff: SessionMainPanelHandoffResult;
  hasSessionSnapshot: boolean;
  sandboxInstanceId: string | null;
  stoppedSessionMessage: string | null;
}): SessionWorkbenchPrimaryPanelState {
  const disabledReason = resolveEnterCliDisabledReason({
    canConnect: input.canConnect,
    cliRuntimeDisplayName: input.cliRuntimeDisplayName,
    hasSessionSnapshot: input.hasSessionSnapshot,
    sandboxInstanceId: input.sandboxInstanceId,
    stoppedSessionMessage: input.stoppedSessionMessage,
    transitionState: input.handoff.transitionState,
  });

  return {
    canEnterCli: disabledReason === null,
    cliRuntimeDisplayName: input.cliRuntimeDisplayName,
    cliTerminalContentInset: input.cliTerminalContentInset,
    cliTerminalThemeMode: "system",
    disabledReason,
    enterCliMode: input.handoff.handoffToCli,
    error: input.handoff.error,
    exitCliMode: input.handoff.handoffToChat,
    isCliToggleActive: input.handoff.isCliToggleActive,
    showsChatComposer: input.handoff.transitionState === "stable_chat",
    transitionState: input.handoff.transitionState,
  };
}

export type { SessionWorkbenchPrimaryPanelState };
