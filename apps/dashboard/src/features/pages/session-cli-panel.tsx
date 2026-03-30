import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { cn } from "@mistle/ui";

import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";

type SessionCliPanelProps = {
  ptyState: ReturnType<typeof useSandboxPtyState>;
};

function resolveCliStatusLabel(input: {
  errorMessage: string | null;
  state: ReturnType<typeof useSandboxPtyState>["lifecycle"]["state"];
}): string {
  if (input.errorMessage !== null) {
    return input.errorMessage;
  }

  switch (input.state) {
    case SandboxPtyStates.CONNECTING:
    case SandboxPtyStates.OPENING:
      return "Connecting Codex CLI...";
    case SandboxPtyStates.OPEN:
      return "Codex CLI connected";
    case SandboxPtyStates.CLOSED:
    case SandboxPtyStates.IDLE:
      return "Codex CLI disconnected";
    case SandboxPtyStates.ERROR:
      return "Codex CLI error";
    case SandboxPtyStates.EXITED:
      return "Codex CLI exited";
    default:
      return "Preparing Codex CLI...";
  }
}

export function SessionCliPanel({ ptyState }: SessionCliPanelProps): React.JSX.Element {
  const { lifecycle, output, actions } = ptyState;
  const statusLabel = resolveCliStatusLabel({
    errorMessage: lifecycle.errorMessage,
    state: lifecycle.state,
  });

  return (
    <section className="flex h-full min-h-[24rem] flex-col overflow-hidden rounded-xl border border-stone-200 bg-stone-950 text-stone-50">
      <header className="flex items-center justify-between border-b border-stone-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2.5 rounded-full",
              lifecycle.state === SandboxPtyStates.OPEN ? "bg-emerald-400" : "bg-stone-500",
            )}
          />
          <span className="text-sm font-medium">CLI</span>
        </div>
        <p className="text-xs text-stone-300">{statusLabel}</p>
      </header>
      <div className="min-h-0 flex-1">
        <SessionTerminalSurface
          isVisible
          lifecycleState={lifecycle.state}
          onResize={actions.resizePty}
          onWriteInput={async (input) => {
            await actions.writeInput(input);
          }}
          outputChunks={output.chunks}
        />
      </div>
    </section>
  );
}
