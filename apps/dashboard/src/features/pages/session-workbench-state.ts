export type SandboxStatusReadState = "error" | "loading" | "ready";

export type SandboxLifecycleStatus = "pending" | "starting" | "running" | "stopped" | "failed";

export type WorkbenchSandboxLifecycleStatus = SandboxLifecycleStatus | "resuming" | null;

export type SandboxAutomationConversation = {
  conversationId: string;
  routeId: string | null;
  providerConversationId: string | null;
} | null;

export type WorkbenchEntryPhase =
  | "connecting"
  | "loading"
  | "ready"
  | "resume_pending"
  | "sandbox_failed"
  | "sandbox_stopped"
  | "sandbox_starting";

export type SessionWorkbenchStatusAlert = {
  title: string;
  description: string;
};

export type SessionWorkbenchStatus =
  | {
      kind: "connected";
      alert: SessionWorkbenchStatusAlert | null;
    }
  | {
      kind: "error";
      alert: SessionWorkbenchStatusAlert | null;
    }
  | {
      kind: "not_connected";
      alert: SessionWorkbenchStatusAlert | null;
    };

export function shouldWaitForAutomationSessionThread(input: {
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
  automationConversation: SandboxAutomationConversation;
}): boolean {
  return (
    input.sandboxStatus === "running" &&
    input.automationConversation !== null &&
    input.automationConversation.providerConversationId === null
  );
}

export function hasAutomationSessionPreparationTimedOut(input: {
  pendingSinceMs: number | null;
  nowMs: number;
}): boolean {
  if (input.pendingSinceMs === null) {
    return false;
  }

  return input.nowMs - input.pendingSinceMs >= 30_000;
}

export function resolveAutomationSessionPreparationTimeoutDelayMs(input: {
  pendingSinceMs: number | null;
  nowMs: number;
}): number | null {
  if (input.pendingSinceMs === null) {
    return null;
  }

  const remainingMs = 30_000 - (input.nowMs - input.pendingSinceMs);
  return remainingMs > 0 ? remainingMs : 0;
}

export function hasFreshSandboxStatusRead(input: {
  initialDataUpdatedAtMs: number | null;
  currentDataUpdatedAtMs: number;
}): boolean {
  if (input.initialDataUpdatedAtMs === null) {
    return false;
  }

  return input.currentDataUpdatedAtMs > input.initialDataUpdatedAtMs;
}

export function hasFreshSandboxStatusReadSinceRecoveryBoundary(input: {
  recoveryBoundaryDataUpdatedAtMs: number | null;
  currentDataUpdatedAtMs: number;
}): boolean {
  if (input.recoveryBoundaryDataUpdatedAtMs === null) {
    return true;
  }

  return input.currentDataUpdatedAtMs > input.recoveryBoundaryDataUpdatedAtMs;
}

export function resolveSandboxStatusReadState(input: {
  hasFreshSandboxStatusSinceMount: boolean;
  hasFreshSandboxStatusSinceRecovery: boolean;
  hasStatusQueryError: boolean;
}): SandboxStatusReadState {
  if (input.hasStatusQueryError) {
    return input.hasFreshSandboxStatusSinceMount && input.hasFreshSandboxStatusSinceRecovery
      ? "ready"
      : "error";
  }

  return input.hasFreshSandboxStatusSinceMount && input.hasFreshSandboxStatusSinceRecovery
    ? "ready"
    : "loading";
}

export function resolveTrustedSandboxStatus(input: {
  sandboxStatusReadState: SandboxStatusReadState;
  sandboxStatus: SandboxLifecycleStatus | null;
}): SandboxLifecycleStatus | null {
  return input.sandboxStatusReadState === "ready" ? input.sandboxStatus : null;
}

export function resolveWorkbenchEntryPhase(input: {
  connectedSession: boolean;
  hasResumeInFlightState: boolean;
  sandboxStatus: SandboxLifecycleStatus | null;
}): WorkbenchEntryPhase {
  if (input.sandboxStatus === "failed") {
    return "sandbox_failed";
  }

  if (input.sandboxStatus === "running") {
    return input.connectedSession ? "ready" : "connecting";
  }

  if (input.sandboxStatus === "starting" || input.sandboxStatus === "pending") {
    return "sandbox_starting";
  }

  if (input.sandboxStatus === "stopped") {
    return input.hasResumeInFlightState ? "resume_pending" : "sandbox_stopped";
  }

  return "loading";
}

export function resolveSandboxLifecycleStatusForWorkbenchEntryPhase(
  phase: WorkbenchEntryPhase,
): WorkbenchSandboxLifecycleStatus {
  if (phase === "sandbox_failed") {
    return "failed";
  }

  if (phase === "sandbox_starting") {
    return "starting";
  }

  if (phase === "resume_pending") {
    return "resuming";
  }

  if (phase === "connecting" || phase === "ready") {
    return "running";
  }

  if (phase === "sandbox_stopped") {
    return "stopped";
  }

  return null;
}

export function resolveStoppedSessionMessageForWorkbenchEntryPhase(input: {
  autoResumeErrorMessage: string | null;
  phase: WorkbenchEntryPhase;
}): string | null {
  if (input.phase !== "sandbox_stopped") {
    return null;
  }

  return (
    input.autoResumeErrorMessage ?? "This sandbox is stopped. Chat and terminal are unavailable."
  );
}

export function resolveSessionWorkbenchStatus(input: {
  sandboxStatusReadState: SandboxStatusReadState;
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus;
  lifecycleErrorMessage: string | null;
  reconnectMessage: string | null;
  sandboxFailureMessage: string | null;
  stoppedSessionMessage: string | null;
}): SessionWorkbenchStatus {
  if (input.lifecycleErrorMessage !== null) {
    return {
      kind: "error",
      alert: {
        title: "Session connection error",
        description: input.lifecycleErrorMessage,
      },
    };
  }

  if (input.sandboxFailureMessage !== null) {
    return {
      kind: "error",
      alert: {
        title: "Sandbox failed",
        description: input.sandboxFailureMessage,
      },
    };
  }

  if (input.sandboxLifecycleStatus === "failed") {
    return {
      kind: "error",
      alert: null,
    };
  }

  if (input.stoppedSessionMessage !== null) {
    return {
      kind: "not_connected",
      alert: {
        title: "Stopped sandbox",
        description: input.stoppedSessionMessage,
      },
    };
  }

  if (input.reconnectMessage !== null) {
    if (input.sandboxLifecycleStatus === "running") {
      return {
        kind: "connected",
        alert: {
          title: "Reconnecting session",
          description: input.reconnectMessage,
        },
      };
    }

    return {
      kind: "not_connected",
      alert: {
        title: "Reconnecting session",
        description: input.reconnectMessage,
      },
    };
  }

  if (
    input.sandboxStatusReadState === "loading" ||
    input.sandboxLifecycleStatus === null ||
    input.sandboxLifecycleStatus === "pending" ||
    input.sandboxLifecycleStatus === "starting" ||
    input.sandboxLifecycleStatus === "resuming" ||
    input.sandboxLifecycleStatus === "stopped"
  ) {
    return {
      kind: "not_connected",
      alert: null,
    };
  }

  return {
    kind: "connected",
    alert: null,
  };
}
