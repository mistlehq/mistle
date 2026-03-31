import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { SessionPtyPanelShell } from "./session-pty-panel-shell.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";

type SessionCliPanelProps = {
  layoutKey?: string;
  ptyState: ReturnType<typeof useSandboxPtyState>;
};

export function SessionCliPanel({ layoutKey, ptyState }: SessionCliPanelProps): React.JSX.Element {
  const { lifecycle, output, actions } = ptyState;
  const layoutKeyProps = layoutKey === undefined ? {} : { layoutKey };

  return (
    <SessionPtyPanelShell
      body={
        <SessionTerminalSurface
          isVisible
          lifecycleState={lifecycle.state}
          onResize={actions.resizePty}
          onWriteInput={actions.writeInput}
          outputChunks={output.chunks}
          {...layoutKeyProps}
        />
      }
      dataPtyState={lifecycle.state}
      showTopBorder={false}
    />
  );
}
