export function isSessionPageNavigableSandboxStatus(
  sandboxStatus: string | null,
): sandboxStatus is "pending" | "starting" | "running" | "stopped" {
  return (
    sandboxStatus === "pending" ||
    sandboxStatus === "starting" ||
    sandboxStatus === "running" ||
    sandboxStatus === "stopped"
  );
}

export type SessionConnectionReadiness = {
  canConnect: boolean;
  reason:
    | "failed"
    | "loading"
    | "missing-session"
    | "ready"
    | "resuming"
    | "starting"
    | "stopped"
    | "unknown";
};

export function isSandboxReadyForConnections(input: {
  sandboxStatus: string | null;
  sandboxConnectable: boolean | null;
}): boolean {
  return input.sandboxStatus === "running" && input.sandboxConnectable === true;
}

export function resolveSessionConnectionReadiness(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: string | null;
  sandboxConnectable: boolean | null;
  isStatusPending: boolean;
}): SessionConnectionReadiness {
  if (input.sandboxInstanceId === null) {
    return {
      canConnect: false,
      reason: "missing-session",
    };
  }

  if (input.isStatusPending && input.sandboxStatus === null) {
    return {
      canConnect: false,
      reason: "loading",
    };
  }

  if (
    isSandboxReadyForConnections({
      sandboxStatus: input.sandboxStatus,
      sandboxConnectable: input.sandboxConnectable,
    })
  ) {
    return {
      canConnect: true,
      reason: "ready",
    };
  }

  if (
    input.sandboxStatus === "pending" ||
    input.sandboxStatus === "starting" ||
    input.sandboxStatus === "running"
  ) {
    return {
      canConnect: false,
      reason: "starting",
    };
  }

  if (input.sandboxStatus === "resuming") {
    return {
      canConnect: false,
      reason: "resuming",
    };
  }

  if (input.sandboxStatus === "stopped") {
    return {
      canConnect: false,
      reason: "stopped",
    };
  }

  if (input.sandboxStatus === "failed") {
    return {
      canConnect: false,
      reason: "failed",
    };
  }

  return {
    canConnect: false,
    reason: "unknown",
  };
}

export function shouldAutoConnectSession(input: {
  sandboxInstanceId: string | null;
  canConnect: boolean;
  connected: boolean;
  isStartingSession: boolean;
  hasAttemptedAutoConnect: boolean;
  hasStartError: boolean;
}): boolean {
  return !(
    input.sandboxInstanceId === null ||
    !input.canConnect ||
    input.connected ||
    input.isStartingSession ||
    input.hasAttemptedAutoConnect ||
    input.hasStartError
  );
}
