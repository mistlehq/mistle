import { Button } from "@mistle/ui";
import { MinusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { INITIAL_PTY_DIMENSIONS, SessionTerminalSurface } from "./session-terminal-surface.js";

const TERMINAL_BORDER_COLOR = "#D6D3D1";

type SessionTerminalPanelProps = {
  onHide: () => void;
  isVisible: boolean;
  onClose: () => Promise<void> | void;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  sandboxInstanceId: string;
};

export function SessionTerminalPanel({
  onHide,
  isVisible,
  onClose,
  ptyState,
  sandboxInstanceId,
}: SessionTerminalPanelProps): React.JSX.Element | null {
  const { lifecycle, output, actions } = ptyState;
  const { openPty, resizePty, writeInput } = actions;
  const hasAttemptedAutoOpenRef = useRef(false);

  useEffect(() => {
    hasAttemptedAutoOpenRef.current = false;
  }, [isVisible, sandboxInstanceId]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    if (
      lifecycle.state === "open" ||
      lifecycle.state === "opening" ||
      lifecycle.state === "connecting"
    ) {
      return;
    }

    if (hasAttemptedAutoOpenRef.current) {
      return;
    }

    hasAttemptedAutoOpenRef.current = true;
    void openPty({
      sandboxInstanceId,
      ...INITIAL_PTY_DIMENSIONS,
    }).catch(() => {
      // Error state is surfaced through lifecycle state and page alerts.
    });
  }, [isVisible, lifecycle.state, openPty, sandboxInstanceId]);

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
      {lifecycle.errorMessage === null ? null : (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {lifecycle.errorMessage}
        </div>
      )}

      <div
        className="flex h-full min-h-0 flex-col overflow-hidden border-t bg-white"
        data-terminal-state={lifecycle.state}
        style={{ borderColor: TERMINAL_BORDER_COLOR }}
      >
        <div
          className="flex items-center justify-end gap-1 border-b bg-white px-3 py-2"
          style={{ borderColor: TERMINAL_BORDER_COLOR }}
        >
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
