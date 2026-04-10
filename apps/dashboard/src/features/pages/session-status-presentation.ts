import type { SessionStatusKind } from "../sessions/session-status.js";

export type SessionStatusBadgeUi = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
};

export function resolveSessionStatusBadgeUi(
  sessionStatus: SessionStatusKind,
): SessionStatusBadgeUi {
  if (sessionStatus === "loading") {
    return {
      label: "Loading status",
      variant: "outline",
    };
  }

  if (sessionStatus === "failed") {
    return {
      label: "Failed",
      variant: "destructive",
    };
  }

  if (sessionStatus === "connected") {
    return {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (sessionStatus === "stopped") {
    return {
      label: "Stopped",
      variant: "outline",
    };
  }

  if (sessionStatus === "reconnecting") {
    return {
      label: "Reconnecting",
      variant: "outline",
    };
  }

  if (sessionStatus === "connecting") {
    return {
      label: "Connecting",
      variant: "outline",
    };
  }

  return {
    label: "Starting",
    variant: "outline",
  };
}
