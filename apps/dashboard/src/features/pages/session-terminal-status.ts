import { SandboxPtyStates, type SandboxPtyState } from "@mistle/sandbox-session-client";

export type SessionTerminalStatusTone = "live" | "offline";

export type SessionTerminalStatusPresentation = {
  label: string;
  showSpinner: boolean;
  tone: SessionTerminalStatusTone;
};

const SESSION_TERMINAL_STATUS_DOT_CLASS: Record<SessionTerminalStatusTone, string> = {
  live: "bg-emerald-500",
  offline: "bg-stone-400",
};

export function sessionTerminalStatusDotClassName(tone: SessionTerminalStatusTone): string {
  return SESSION_TERMINAL_STATUS_DOT_CLASS[tone];
}

export function resolveSessionTerminalStatusPresentation(
  state: SandboxPtyState,
): SessionTerminalStatusPresentation {
  switch (state) {
    case SandboxPtyStates.IDLE:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.CONNECTING:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.CONNECTED:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.OPENING:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.OPEN:
      return { label: "Active", showSpinner: false, tone: "live" };
    case SandboxPtyStates.CLOSING:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.CLOSED:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.ERROR:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    case SandboxPtyStates.EXITED:
      return { label: "Inactive", showSpinner: false, tone: "offline" };
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled sandbox PTY state: ${String(exhaustive)}`);
    }
  }
}
