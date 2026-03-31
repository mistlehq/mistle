import { SandboxPtyStates } from "@mistle/sandbox-session-client";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { SessionPtyPanelHeader } from "./session-pty-panel-header.js";
import { SessionPtyPanelShell } from "./session-pty-panel-shell.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";

type SessionCliPanelProps = {
  ptyState: ReturnType<typeof useSandboxPtyState>;
};

export function SessionCliPanel({ ptyState }: SessionCliPanelProps): React.JSX.Element {
  const { lifecycle, output, actions } = ptyState;

  return (
    <SessionPtyPanelShell
      body={
        <SessionTerminalSurface
          isVisible
          lifecycleState={lifecycle.state}
          onResize={actions.resizePty}
          onWriteInput={actions.writeInput}
          outputChunks={output.chunks}
        />
      }
      dataPtyState={lifecycle.state}
      header={
        <SessionPtyPanelHeader
          indicatorTitle="Codex CLI"
          isActive={lifecycle.state === SandboxPtyStates.OPEN}
          title="CLI"
        />
      }
    />
  );
}
