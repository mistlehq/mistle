export type SandboxHeaderStatusUi = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
};

export function resolveSandboxHeaderStatusUi(input: {
  sandboxLifecycleStatus: string;
}): SandboxHeaderStatusUi {
  if (input.sandboxLifecycleStatus === "failed") {
    return {
      label: "Sandbox failed",
      variant: "destructive",
    };
  }

  if (input.sandboxLifecycleStatus === "running") {
    return {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (input.sandboxLifecycleStatus === "stopped") {
    return {
      label: "Sandbox stopped",
      variant: "outline",
    };
  }

  if (input.sandboxLifecycleStatus === "resuming") {
    return {
      label: "Resuming sandbox",
      variant: "outline",
    };
  }

  if (input.sandboxLifecycleStatus !== "running") {
    return {
      label: "Starting sandbox",
      variant: "outline",
    };
  }

  throw new Error(`Unexpected sandbox lifecycle status: ${input.sandboxLifecycleStatus}`);
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

export function resolveStoppedSessionMessage(input: {
  connectionReadinessReason:
    | "failed"
    | "loading"
    | "missing-session"
    | "ready"
    | "resuming"
    | "starting"
    | "stopped"
    | "unknown";
}): string | null {
  if (input.connectionReadinessReason !== "stopped") {
    return null;
  }

  return "This sandbox is stopped. Resume it to reconnect chat and terminal.";
}

export function shouldShowResumeAction(input: {
  requiresManualResume: boolean;
  isResumingStoppedSandbox: boolean;
}): boolean {
  return input.requiresManualResume;
}
