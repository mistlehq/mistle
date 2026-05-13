import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { SessionPtyPanelShell } from "./session-pty-panel-shell.js";
import {
  SessionTerminalSurface,
  type SessionTerminalContentInset,
  type SessionTerminalThemeMode,
} from "./session-terminal-surface.js";

type SessionCliPanelProps = {
  ptyState: ReturnType<typeof useSandboxPtyState>;
  refitKey?: string;
  terminalContentInset?: SessionTerminalContentInset;
  terminalThemeMode?: SessionTerminalThemeMode;
};

export function SessionCliPanel({
  ptyState,
  refitKey,
  terminalContentInset = "default",
  terminalThemeMode = "system",
}: SessionCliPanelProps): React.JSX.Element {
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
          contentInset={terminalContentInset}
          themeMode={terminalThemeMode}
          {...refitKeyProps}
        />
      }
      dataPtyState={lifecycle.state}
      showTopBorder={false}
    />
  );
}
