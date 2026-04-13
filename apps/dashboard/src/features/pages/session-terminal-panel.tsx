import type {
  SandboxPtyExitInfo,
  SandboxPtyResetInfo,
  SandboxPtyState,
} from "@mistle/sandbox-session-client";
import { Button } from "@mistle/ui";
import { MinusIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useReducer, useRef } from "react";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { SessionPtyPanelHeader } from "./session-pty-panel-header.js";
import { SessionPtyPanelShell } from "./session-pty-panel-shell.js";
import { INITIAL_PTY_DIMENSIONS, SessionTerminalSurface } from "./session-terminal-surface.js";
const MaxTerminalReconnectAttempts = 3;

type SessionTerminalRecoverySandboxStatus =
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
      sandboxStatus: SessionTerminalRecoverySandboxStatus;
    };

function shouldAutoOpenTerminal(input: {
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

function shouldHandleTerminalExit(input: {
  exitInfo: SandboxPtyExitInfo | null;
  hasHandledExit: boolean;
}): boolean {
  return input.exitInfo !== null && !input.hasHandledExit;
}

function shouldOpenPtyForRecovery(input: {
  attemptCount: number;
  errorMessage: string | null;
  isReconnectAttemptInFlight: boolean;
  lifecycleState: SandboxPtyState;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
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

function SessionTerminalToolbarStatus(input: {
  errorMessage: string | null;
  isRecovering: boolean;
  state: SandboxPtyState;
}): React.JSX.Element {
  const label = input.isRecovering
    ? "Reconnecting"
    : input.state === "open"
      ? "Active"
      : "Inactive";
  const liveStatusText =
    input.errorMessage === null
      ? `Terminal status: ${label}`
      : `Terminal status: ${label}. ${input.errorMessage}`;

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="flex min-w-0 flex-1 items-center gap-2"
      role="status"
    >
      <span className="sr-only">{liveStatusText}</span>
      <div aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
        <SessionPtyPanelHeader title="Terminal" />
        {input.isRecovering ? (
          <SpinnerGapIcon className="size-4 shrink-0 animate-spin text-stone-500" />
        ) : null}
      </div>
    </div>
  );
}

export function shouldAttemptTerminalReconnect(input: {
  recovery: TerminalRecoveryState;
}): boolean {
  return input.recovery.kind === "recovering" && input.recovery.command === "reopen";
}

export function resolveTerminalRecoveryMessage(input: {
  recovery: TerminalRecoveryState;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
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
  sandboxInstanceId: string;
}): {
  sandboxInstanceId: string;
  ptySessionId: "terminal";
  cols: number;
  rows: number;
  cwd?: string;
} {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: "terminal",
    ...INITIAL_PTY_DIMENSIONS,
    ...(input.cwd === null ? {} : { cwd: input.cwd }),
  };
}

type SessionTerminalPanelProps = {
  cwd: string | null;
  onHide: () => void;
  isVisible: boolean;
  isConnectionReady: boolean;
  onDisconnectTerminal: () => Promise<void> | void;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
  sandboxInstanceId: string;
};

export function SessionTerminalPanel({
  cwd,
  onHide,
  isVisible,
  isConnectionReady,
  onDisconnectTerminal,
  ptyState,
  sandboxStatus,
  sandboxInstanceId,
}: SessionTerminalPanelProps): React.JSX.Element | null {
  const { lifecycle, output, actions } = ptyState;
  const { openPty, resizePty, writeInput } = actions;
  const hasAttemptedAutoOpenRef = useRef(false);
  const hasHandledExitRef = useRef(false);
  const isReconnectAttemptInFlightRef = useRef(false);
  const lastHandledResetRef = useRef<SandboxPtyResetInfo | null>(null);
  const [recovery, dispatchRecoveryEvent] = useReducer(reduceTerminalRecoveryState, {
    kind: "idle",
  } satisfies TerminalRecoveryState);

  useEffect(() => {
    if (
      !isVisible ||
      lifecycle.resetInfo === null ||
      lastHandledResetRef.current === lifecycle.resetInfo
    ) {
      return;
    }

    lastHandledResetRef.current = lifecycle.resetInfo;
    isReconnectAttemptInFlightRef.current = false;
    dispatchRecoveryEvent({
      type: "reset_seen",
      resetInfo: lifecycle.resetInfo,
    });
  }, [isVisible, lifecycle.resetInfo]);

  useEffect(() => {
    dispatchRecoveryEvent({
      type: "sync_observed",
      isReconnectAttemptInFlight: isReconnectAttemptInFlightRef.current,
      lifecycleState: lifecycle.state,
      sandboxStatus,
    });
  }, [lifecycle.state, recovery.kind, sandboxStatus]);

  useEffect(() => {
    if (!shouldAttemptTerminalReconnect({ recovery })) {
      return;
    }

    isReconnectAttemptInFlightRef.current = true;
    dispatchRecoveryEvent({
      type: "reopen_requested",
    });

    void openPty(
      buildTerminalPtyOpenInput({
        cwd,
        sandboxInstanceId,
      }),
    )
      .catch((error) => {
        dispatchRecoveryEvent({
          type: "reopen_failed",
          message: error instanceof Error ? error.message : "Could not reopen sandbox terminal.",
        });
      })
      .finally(() => {
        isReconnectAttemptInFlightRef.current = false;
        dispatchRecoveryEvent({
          type: "sync_observed",
          isReconnectAttemptInFlight: false,
          lifecycleState: lifecycle.state,
          sandboxStatus,
        });
      });
  }, [cwd, lifecycle.state, openPty, recovery, sandboxInstanceId, sandboxStatus]);

  const terminalRecoveryMessage = resolveTerminalRecoveryMessage({
    recovery,
    sandboxStatus,
  });

  useEffect(() => {
    if (lifecycle.exitInfo === null) {
      hasHandledExitRef.current = false;
      return;
    }

    if (
      !shouldHandleTerminalExit({
        exitInfo: lifecycle.exitInfo,
        hasHandledExit: hasHandledExitRef.current,
      })
    ) {
      return;
    }

    hasHandledExitRef.current = true;
    void handleDisconnectTerminal();
  }, [lifecycle.exitInfo]);

  useEffect(() => {
    if (
      !shouldAutoOpenTerminal({
        isVisible,
        isConnectionReady,
        lifecycleState: lifecycle.state,
        hasAttemptedAutoOpen: hasAttemptedAutoOpenRef.current,
      })
    ) {
      return;
    }

    hasAttemptedAutoOpenRef.current = true;
    void openPty(
      buildTerminalPtyOpenInput({
        cwd,
        sandboxInstanceId,
      }),
    ).catch(() => {
      // Error state is surfaced through lifecycle state and page alerts.
    });
  }, [cwd, isConnectionReady, isVisible, lifecycle.state, openPty, sandboxInstanceId]);

  async function handleHideTerminal(): Promise<void> {
    onHide();
  }

  async function handleDisconnectTerminal(): Promise<void> {
    output.clearOutput();
    await onDisconnectTerminal();
  }

  if (!isVisible) {
    return null;
  }

  return (
    <SessionPtyPanelShell
      body={
        <SessionTerminalSurface
          isVisible={isVisible}
          lifecycleState={lifecycle.state}
          onResize={resizePty}
          onWriteInput={writeInput}
          outputChunks={output.chunks}
        />
      }
      dataPtyState={lifecycle.state}
      header={
        <>
          <SessionTerminalToolbarStatus
            errorMessage={lifecycle.errorMessage}
            isRecovering={recovery.kind === "recovering"}
            state={lifecycle.state}
          />
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="Hide terminal"
              onClick={() => void handleHideTerminal()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MinusIcon className="size-4" />
            </Button>
            <Button
              aria-label="Close terminal"
              onClick={() => void handleDisconnectTerminal()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </>
      }
      message={terminalRecoveryMessage ?? undefined}
    />
  );
}

export { shouldAutoOpenTerminal, shouldHandleTerminalExit };
