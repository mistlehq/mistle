import type {
  SandboxPtyExitInfo,
  SandboxPtyResetInfo,
  SandboxPtyState,
} from "@mistle/sandbox-session-client";
import { Button, cn } from "@mistle/ui";
import { MinusIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  resolveSessionTerminalStatusPresentation,
  sessionTerminalStatusDotClassName,
} from "./session-terminal-status.js";
import { INITIAL_PTY_DIMENSIONS, SessionTerminalSurface } from "./session-terminal-surface.js";

const TERMINAL_BORDER_COLOR = "#D6D3D1";
const MaxTerminalReconnectAttempts = 3;

type SessionTerminalRecoverySandboxStatus =
  | "pending"
  | "starting"
  | "running"
  | "resuming"
  | "stopped"
  | "failed"
  | null;

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

function SessionTerminalToolbarStatus(input: {
  errorMessage: string | null;
  isRecovering: boolean;
  state: SandboxPtyState;
}): React.JSX.Element {
  const presentation = resolveSessionTerminalStatusPresentation({
    state: input.state,
    isRecovering: input.isRecovering,
  });
  const dotClass = sessionTerminalStatusDotClassName(presentation.tone);
  const liveStatusText =
    input.errorMessage === null
      ? `Terminal status: ${presentation.label}`
      : `Terminal status: ${presentation.label}. ${input.errorMessage}`;
  const indicatorTitle =
    input.errorMessage === null
      ? `Terminal ${presentation.label.toLowerCase()}`
      : `Terminal ${presentation.label.toLowerCase()}: ${input.errorMessage}`;

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="flex min-w-0 flex-1 items-center gap-2"
      role="status"
    >
      <span className="sr-only">{liveStatusText}</span>
      <div aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold text-stone-900">Terminal</span>
        <span className="flex items-center gap-2" title={indicatorTitle}>
          {presentation.showSpinner ? (
            <SpinnerGapIcon className="size-4 shrink-0 animate-spin text-stone-500" />
          ) : null}
          <span className={cn("size-2.5 shrink-0 rounded-full", dotClass)} />
        </span>
      </div>
    </div>
  );
}

export function shouldRequestTerminalResume(input: {
  isRecovering: boolean;
  isResumingSandbox: boolean;
  isVisible: boolean;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
}): boolean {
  return (
    input.isVisible &&
    input.isRecovering &&
    !input.isResumingSandbox &&
    input.sandboxStatus === "stopped"
  );
}

export function shouldAttemptTerminalReconnect(input: {
  isRecovering: boolean;
  isReconnectAttemptInFlight: boolean;
  isVisible: boolean;
  lifecycleState: SandboxPtyState;
  reconnectAttemptCount: number;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
}): boolean {
  if (
    !input.isVisible ||
    !input.isRecovering ||
    input.isReconnectAttemptInFlight ||
    input.sandboxStatus !== "running" ||
    input.reconnectAttemptCount >= MaxTerminalReconnectAttempts
  ) {
    return false;
  }

  return (
    input.lifecycleState !== "open" &&
    input.lifecycleState !== "opening" &&
    input.lifecycleState !== "connecting"
  );
}

export function resolveTerminalRecoveryMessage(input: {
  isRecovering: boolean;
  recoveryErrorMessage: string | null;
  reconnectAttemptCount: number;
  resetInfo: SandboxPtyResetInfo | null;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
}): string | null {
  if (input.recoveryErrorMessage !== null) {
    return input.recoveryErrorMessage;
  }

  if (!input.isRecovering || input.resetInfo === null) {
    return null;
  }

  const prefix = `Terminal disconnected: ${input.resetInfo.message}`;
  switch (input.sandboxStatus) {
    case "stopped":
      return `${prefix} Resuming sandbox to restore the terminal.`;
    case "pending":
    case "starting":
    case "resuming":
      return `${prefix} Waiting for the sandbox to become ready again.`;
    case "running":
      return `${prefix} Reconnecting terminal${input.reconnectAttemptCount > 0 ? ` (attempt ${String(input.reconnectAttemptCount)} of ${String(MaxTerminalReconnectAttempts)})` : ""}.`;
    case "failed":
      return `${prefix} The sandbox failed and the terminal cannot reconnect.`;
    default:
      return `${prefix} Reconnecting terminal.`;
  }
}

type SessionTerminalPanelProps = {
  isResumingSandbox: boolean;
  onHide: () => void;
  isVisible: boolean;
  isConnectionReady: boolean;
  onDisconnectTerminal: () => Promise<void> | void;
  onRequestSandboxResume: () => Promise<void>;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
  sandboxInstanceId: string;
};

export function SessionTerminalPanel({
  isResumingSandbox,
  onHide,
  isVisible,
  isConnectionReady,
  onDisconnectTerminal,
  onRequestSandboxResume,
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
  const [isRecovering, setIsRecovering] = useState(false);
  const [reconnectAttemptCount, setReconnectAttemptCount] = useState(0);
  const [recoveryErrorMessage, setRecoveryErrorMessage] = useState<string | null>(null);

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
    setReconnectAttemptCount(0);
    setRecoveryErrorMessage(null);
    setIsRecovering(true);
  }, [isVisible, lifecycle.resetInfo]);

  useEffect(() => {
    if (lifecycle.state !== "open") {
      return;
    }

    isReconnectAttemptInFlightRef.current = false;
    setIsRecovering(false);
    setReconnectAttemptCount(0);
    setRecoveryErrorMessage(null);
  }, [lifecycle.state]);

  useEffect(() => {
    if (sandboxStatus !== "failed" || !isRecovering) {
      return;
    }

    isReconnectAttemptInFlightRef.current = false;
    setIsRecovering(false);
    setRecoveryErrorMessage("Terminal disconnected and the sandbox failed.");
  }, [isRecovering, sandboxStatus]);

  useEffect(() => {
    if (!isRecovering || reconnectAttemptCount < MaxTerminalReconnectAttempts) {
      return;
    }

    isReconnectAttemptInFlightRef.current = false;
    setIsRecovering(false);
    setRecoveryErrorMessage(
      `Could not reconnect terminal after ${String(MaxTerminalReconnectAttempts)} attempts.`,
    );
  }, [isRecovering, reconnectAttemptCount]);

  useEffect(() => {
    if (
      !shouldRequestTerminalResume({
        isRecovering,
        isResumingSandbox,
        isVisible,
        sandboxStatus,
      })
    ) {
      return;
    }

    void onRequestSandboxResume().catch(() => {
      // Resume errors surface through the existing stopped-sandbox alert state.
    });
  }, [isRecovering, isResumingSandbox, isVisible, onRequestSandboxResume, sandboxStatus]);

  useEffect(() => {
    if (
      !shouldAttemptTerminalReconnect({
        isRecovering,
        isReconnectAttemptInFlight: isReconnectAttemptInFlightRef.current,
        isVisible,
        lifecycleState: lifecycle.state,
        reconnectAttemptCount,
        sandboxStatus,
      })
    ) {
      return;
    }

    isReconnectAttemptInFlightRef.current = true;
    setReconnectAttemptCount((currentCount) => currentCount + 1);

    void openPty({
      sandboxInstanceId,
      ...INITIAL_PTY_DIMENSIONS,
    })
      .catch((error) => {
        setRecoveryErrorMessage(
          error instanceof Error ? error.message : "Could not reopen sandbox terminal.",
        );
      })
      .finally(() => {
        isReconnectAttemptInFlightRef.current = false;
      });
  }, [
    isRecovering,
    isVisible,
    lifecycle.state,
    openPty,
    reconnectAttemptCount,
    sandboxInstanceId,
    sandboxStatus,
  ]);

  const terminalRecoveryMessage = resolveTerminalRecoveryMessage({
    isRecovering,
    recoveryErrorMessage,
    reconnectAttemptCount,
    resetInfo: lifecycle.resetInfo,
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
    void openPty({
      sandboxInstanceId,
      ...INITIAL_PTY_DIMENSIONS,
    }).catch(() => {
      // Error state is surfaced through lifecycle state and page alerts.
    });
  }, [isConnectionReady, isVisible, lifecycle.state, openPty, sandboxInstanceId]);

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
    <div className="bg-white h-full min-h-0">
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden border-t bg-white"
        data-terminal-state={lifecycle.state}
        style={{ borderColor: TERMINAL_BORDER_COLOR }}
      >
        <div className="flex items-center gap-2 bg-white px-3 py-1">
          <SessionTerminalToolbarStatus
            errorMessage={lifecycle.errorMessage}
            isRecovering={isRecovering}
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
        </div>
        {terminalRecoveryMessage === null ? null : (
          <div className="border-b border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
            {terminalRecoveryMessage}
          </div>
        )}
        <SessionTerminalSurface
          isVisible={isVisible}
          lifecycleState={lifecycle.state}
          onResize={resizePty}
          onWriteInput={writeInput}
          outputChunks={output.chunks}
        />
      </div>
    </div>
  );
}

export { shouldHandleTerminalExit, shouldAutoOpenTerminal };
