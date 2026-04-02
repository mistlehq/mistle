import {
  resolveSandboxStatusBadgeUi,
  type SandboxStatusBadgeUi,
  type WorkbenchSandboxLifecycleStatus,
} from "./sandbox-status-presentation.js";

export type WorkbenchSessionConnectionStatus =
  | "connected"
  | "connecting"
  | "error"
  | "reconnecting";

function resolveSessionConnectionStatusBadgeUi(
  sessionConnectionStatus: WorkbenchSessionConnectionStatus,
): SandboxStatusBadgeUi {
  if (sessionConnectionStatus === "connected") {
    return {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (sessionConnectionStatus === "reconnecting") {
    return {
      label: "Reconnecting",
      variant: "outline",
    };
  }

  if (sessionConnectionStatus === "error") {
    return {
      label: "Session error",
      variant: "destructive",
    };
  }

  return {
    label: "Connecting",
    variant: "outline",
  };
}

export function resolveSandboxHeaderStatusUi(input: {
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus;
  sessionConnectionStatus: WorkbenchSessionConnectionStatus | null;
}): SandboxStatusBadgeUi {
  if (input.sandboxLifecycleStatus === "running" && input.sessionConnectionStatus !== null) {
    return resolveSessionConnectionStatusBadgeUi(input.sessionConnectionStatus);
  }

  return resolveSandboxStatusBadgeUi(input.sandboxLifecycleStatus);
}

export function hasSessionTopAlert(input: {
  hasSandboxStatusError: boolean;
  lifecycleErrorMessage: string | null;
  reconnectMessage: string | null;
  sandboxFailureMessage: string | null;
  stoppedSessionMessage: string | null;
}): boolean {
  return (
    input.hasSandboxStatusError ||
    input.lifecycleErrorMessage !== null ||
    input.reconnectMessage !== null ||
    input.sandboxFailureMessage !== null ||
    input.stoppedSessionMessage !== null
  );
}

export function shouldShowResumeAction(input: { requiresManualResume: boolean }): boolean {
  return input.requiresManualResume;
}
