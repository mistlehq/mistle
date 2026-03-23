import type { SandboxPtyState } from "@mistle/sandbox-session-client";
import { Button, cn } from "@mistle/ui";
import { MinusIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  resolveSessionTerminalStatusPresentation,
  sessionTerminalStatusDotClassName,
} from "./session-terminal-status.js";
import { INITIAL_PTY_DIMENSIONS, SessionTerminalSurface } from "./session-terminal-surface.js";

const TERMINAL_BORDER_COLOR = "#D6D3D1";

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

function SessionTerminalToolbarStatus(input: {
  errorMessage: string | null;
  state: SandboxPtyState;
}): React.JSX.Element {
  const presentation = resolveSessionTerminalStatusPresentation(input.state);
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

type SessionTerminalPanelProps = {
  onHide: () => void;
  isVisible: boolean;
  isConnectionReady: boolean;
  onClose: () => Promise<void> | void;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  sandboxInstanceId: string;
  sandboxStatus: string | null;
};

export function SessionTerminalPanel({
  onHide,
  isVisible,
  isConnectionReady,
  onClose,
  ptyState,
  sandboxInstanceId,
  sandboxStatus,
}: SessionTerminalPanelProps): React.JSX.Element | null {
  const { lifecycle, output, actions } = ptyState;
  const { openPty, resizePty, writeInput } = actions;
  const hasAttemptedAutoOpenRef = useRef(false);

  useEffect(() => {
    hasAttemptedAutoOpenRef.current = false;
  }, [isConnectionReady, isVisible, sandboxInstanceId, sandboxStatus]);

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

  async function handleCloseTerminal(): Promise<void> {
    output.clearOutput();
    await onClose();
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
        <div
          className="flex items-center gap-2 border-b bg-white px-3 py-1"
          style={{ borderColor: TERMINAL_BORDER_COLOR }}
        >
          <SessionTerminalToolbarStatus
            errorMessage={lifecycle.errorMessage}
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
              onClick={() => void handleCloseTerminal()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>
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

export { shouldAutoOpenTerminal };
