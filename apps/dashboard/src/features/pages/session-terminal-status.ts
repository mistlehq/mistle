import { SandboxPtyStates, type SandboxPtyState } from "@mistle/sandbox-session-client";

export type SessionTerminalStatusTone = "live" | "pending" | "standby" | "offline" | "error";

export type SessionTerminalStatusPresentation = {
  label: string;
  showSpinner: boolean;
  tone: SessionTerminalStatusTone;
};

const SESSION_TERMINAL_STATUS_DOT_CLASS: Record<SessionTerminalStatusTone, string> = {
  error: "bg-rose-600",
  live: "bg-emerald-500",
  offline: "bg-stone-400",
  pending: "bg-amber-500",
  standby: "bg-sky-500",
};

export function sessionTerminalStatusDotClassName(tone: SessionTerminalStatusTone): string {
  return SESSION_TERMINAL_STATUS_DOT_CLASS[tone];
}

export function resolveSessionTerminalStatusPresentation(
  state: SandboxPtyState,
): SessionTerminalStatusPresentation {
  switch (state) {
    case SandboxPtyStates.IDLE:
      return { label: "Idle", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.CONNECTING:
      return { label: "Connecting", showSpinner: true, tone: "pending" };
    case SandboxPtyStates.CONNECTED:
      return { label: "Linked", showSpinner: false, tone: "standby" };
    case SandboxPtyStates.OPENING:
      return { label: "Opening", showSpinner: true, tone: "pending" };
    case SandboxPtyStates.OPEN:
      return { label: "Active", showSpinner: false, tone: "live" };
    case SandboxPtyStates.CLOSING:
      return { label: "Closing", showSpinner: true, tone: "pending" };
    case SandboxPtyStates.CLOSED:
      return { label: "Disconnected", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.ERROR:
      return { label: "Error", showSpinner: false, tone: "error" };
    case SandboxPtyStates.EXITED:
      return { label: "Exited", showSpinner: false, tone: "offline" };
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled sandbox PTY state: ${String(exhaustive)}`);
    }
  }
}
