import type {
  SandboxPtyExitInfo,
  SandboxPtyResetInfo,
  SandboxPtyState,
} from "@mistle/sandbox-session-client";

import { INITIAL_PTY_DIMENSIONS } from "./session-terminal-surface.js";

const MaxTerminalReconnectAttempts = 3;

export type SessionTerminalSandboxStatus =
  | "pending"
  | "starting"
  | "running"
  | "resuming"
  | "stopped"
  | "failed"
  | null;

export type TerminalRecoveryState =
  | {
      kind: "idle";
    }
  | {
      kind: "recovering";
      attemptCount: number;
      command: "none" | "reopen";
      errorMessage: string | null;
      resetInfo: SandboxPtyResetInfo;
    };

type TerminalRecoveryEvent =
  | {
      type: "reopen_failed";
      message: string;
    }
  | {
      type: "reopen_requested";
    }
  | {
      type: "reset_seen";
      resetInfo: SandboxPtyResetInfo;
    }
  | {
      type: "sync_observed";
      isReconnectAttemptInFlight: boolean;
      lifecycleState: SandboxPtyState;
      sandboxStatus: SessionTerminalSandboxStatus;
    };

function shouldOpenPtyForRecovery(input: {
  attemptCount: number;
  errorMessage: string | null;
  isReconnectAttemptInFlight: boolean;
  lifecycleState: SandboxPtyState;
  sandboxStatus: SessionTerminalSandboxStatus;
}): boolean {
  if (
    input.errorMessage !== null ||
    input.isReconnectAttemptInFlight ||
    input.sandboxStatus !== "running" ||
    input.attemptCount >= MaxTerminalReconnectAttempts
  ) {
    return false;
  }

  return (
    input.lifecycleState !== "open" &&
    input.lifecycleState !== "opening" &&
    input.lifecycleState !== "connecting"
  );
}

export function shouldAutoOpenTerminal(input: {
  isVisible: boolean;
  isConnectionReady: boolean;
  lifecycleState: SandboxPtyState;
  hasAttemptedAutoOpen: boolean;
}): boolean {
  if (!input.isVisible) {
    return false;
  }

  if (!input.isConnectionReady) {
    return false;
  }

  if (
    input.lifecycleState === "open" ||
    input.lifecycleState === "opening" ||
    input.lifecycleState === "connecting"
  ) {
    return false;
  }

  return !input.hasAttemptedAutoOpen;
}

export function shouldHandleTerminalExit(input: {
  exitInfo: SandboxPtyExitInfo | null;
  hasHandledExit: boolean;
}): boolean {
  return input.exitInfo !== null && !input.hasHandledExit;
}

export function shouldObserveTerminalReset(input: {
  isTerminalVisible: boolean;
  lastHandledReset: SandboxPtyResetInfo | null;
  nextReset: SandboxPtyResetInfo | null;
}): input is {
  isTerminalVisible: true;
  lastHandledReset: SandboxPtyResetInfo | null;
  nextReset: SandboxPtyResetInfo;
} {
  return (
    input.isTerminalVisible &&
    input.nextReset !== null &&
    input.lastHandledReset !== input.nextReset
  );
}

export function reduceTerminalRecoveryState(
  state: TerminalRecoveryState,
  event: TerminalRecoveryEvent,
): TerminalRecoveryState {
  switch (state.kind) {
    case "idle": {
      if (event.type === "reset_seen") {
        return {
          kind: "recovering",
          attemptCount: 0,
          command: "none",
          errorMessage: null,
          resetInfo: event.resetInfo,
        };
      }

      return state;
    }
    case "recovering": {
      switch (event.type) {
        case "reset_seen":
          return {
            kind: "recovering",
            attemptCount: 0,
            command: "none",
            errorMessage: null,
            resetInfo: event.resetInfo,
          };
        case "reopen_requested":
          if (state.command !== "reopen") {
            return state;
          }

          return {
            ...state,
            attemptCount: state.attemptCount + 1,
            command: "none",
          };
        case "reopen_failed":
          return {
            ...state,
            command: "none",
            errorMessage: event.message,
          };
        case "sync_observed":
          if (event.lifecycleState === "open") {
            return {
              kind: "idle",
            };
          }

          if (event.sandboxStatus === "failed") {
            return {
              ...state,
              command: "none",
              errorMessage: "Terminal disconnected and the sandbox failed.",
            };
          }

          if (state.errorMessage !== null) {
            return state.command === "none"
              ? state
              : {
                  ...state,
                  command: "none",
                };
          }

          if (state.attemptCount >= MaxTerminalReconnectAttempts) {
            return {
              ...state,
              command: "none",
              errorMessage: `Could not reconnect terminal after ${String(MaxTerminalReconnectAttempts)} attempts.`,
            };
          }

          if (event.sandboxStatus === "stopped") {
            return {
              ...state,
              command: "none",
              errorMessage: "Terminal disconnected and the sandbox stopped.",
            };
          }

          if (
            shouldOpenPtyForRecovery({
              attemptCount: state.attemptCount,
              errorMessage: state.errorMessage,
              isReconnectAttemptInFlight: event.isReconnectAttemptInFlight,
              lifecycleState: event.lifecycleState,
              sandboxStatus: event.sandboxStatus,
            })
          ) {
            return state.command === "reopen"
              ? state
              : {
                  ...state,
                  command: "reopen",
                };
          }

          return state.command === "none"
            ? state
            : {
                ...state,
                command: "none",
              };
      }
    }
  }
}

export function shouldAttemptTerminalReconnect(input: {
  recovery: TerminalRecoveryState;
}): boolean {
  return input.recovery.kind === "recovering" && input.recovery.command === "reopen";
}

export function resolveTerminalRecoveryMessage(input: {
  recovery: TerminalRecoveryState;
  sandboxStatus: SessionTerminalSandboxStatus;
}): string | null {
  if (input.recovery.kind !== "recovering") {
    return null;
  }

  if (input.recovery.errorMessage !== null) {
    return input.recovery.errorMessage;
  }

  const prefix = `Terminal disconnected: ${input.recovery.resetInfo.message}`;
  switch (input.sandboxStatus) {
    case "stopped":
      return `${prefix} The sandbox stopped and the terminal cannot reconnect.`;
    case "pending":
    case "starting":
    case "resuming":
      return `${prefix} Waiting for the sandbox to become ready again.`;
    case "running":
      return `${prefix} Reconnecting terminal${input.recovery.attemptCount > 0 ? ` (attempt ${String(input.recovery.attemptCount)} of ${String(MaxTerminalReconnectAttempts)})` : ""}.`;
    case "failed":
      return `${prefix} The sandbox failed and the terminal cannot reconnect.`;
    default:
      return `${prefix} Reconnecting terminal.`;
  }
}

export function buildTerminalPtyOpenInput(input: {
  cwd: string | null;
  ptySessionId?: string;
  sandboxInstanceId: string;
}): {
  sandboxInstanceId: string;
  ptySessionId: string;
  cols: number;
  rows: number;
  cwd?: string;
} {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: input.ptySessionId ?? "terminal",
    ...INITIAL_PTY_DIMENSIONS,
    ...(input.cwd === null ? {} : { cwd: input.cwd }),
  };
}
