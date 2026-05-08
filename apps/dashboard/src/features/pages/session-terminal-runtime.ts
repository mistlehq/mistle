import type {
  SandboxPtyExitInfo,
  SandboxPtyResetInfo,
  SandboxPtyState,
} from "@mistle/sandbox-session-client";

import { INITIAL_PTY_DIMENSIONS } from "./session-terminal-surface.js";
import type { WorkbenchSandboxLifecycleStatus } from "./session-workbench-state.js";

const MaxTerminalReconnectAttempts = 3;
type TerminalRecoveryFailure = null | "reopen_failed" | "sandbox_failed" | "sandbox_stopped";

export type TerminalRecoveryState =
  | {
      kind: "idle";
    }
  | {
      kind: "recovering";
      attemptCount: number;
      command: "none" | "reopen";
      failure: TerminalRecoveryFailure;
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
      sandboxStatus: WorkbenchSandboxLifecycleStatus;
    };

function shouldOpenPtyForRecovery(input: {
  attemptCount: number;
  failure: TerminalRecoveryFailure;
  isReconnectAttemptInFlight: boolean;
  lifecycleState: SandboxPtyState;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
}): boolean {
  if (
    input.failure !== null ||
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
          failure: null,
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
            failure: null,
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
            failure: "reopen_failed",
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
              failure: "sandbox_failed",
            };
          }

          if (state.failure !== null) {
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
              failure: "reopen_failed",
            };
          }

          if (event.sandboxStatus === "stopped") {
            return {
              ...state,
              command: "none",
              failure: "sandbox_stopped",
            };
          }

          if (
            shouldOpenPtyForRecovery({
              attemptCount: state.attemptCount,
              failure: state.failure,
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

export function buildTerminalPtyOpenInput(input: {
  cwd: string;
  ptySessionId?: string;
  sandboxInstanceId: string;
}): {
  sandboxInstanceId: string;
  ptySessionId: string;
  cols: number;
  rows: number;
  cwd: string;
} {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: input.ptySessionId ?? "terminal",
    ...INITIAL_PTY_DIMENSIONS,
    cwd: input.cwd,
  };
}
