import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { SessionPtyPanelShell } from "./session-pty-panel-shell.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";

type SessionCliPanelProps = {
  ptyState: ReturnType<typeof useSandboxPtyState>;
  refitKey?: string;
};

export function SessionCliPanel({ ptyState, refitKey }: SessionCliPanelProps): React.JSX.Element {
  const { lifecycle, output, actions } = ptyState;
  const refitKeyProps = refitKey === undefined ? {} : { refitKey };

  return (
    <SessionPtyPanelShell
      body={
        <SessionTerminalSurface
          isVisible
          lifecycleState={lifecycle.state}
          onResize={actions.resizePty}
          onWriteInput={actions.writeInput}
          outputChunks={output.chunks}
          {...refitKeyProps}
        />
      }
      dataPtyState={lifecycle.state}
      showTopBorder={false}
    />
  );
}
