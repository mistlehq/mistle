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
  | "manual_resume_required"
  | "ready"
  | "resume_pending"
  | "sandbox_failed"
  | "sandbox_starting";

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

export function shouldShowResumeInFlightState(input: {
  hasAttemptedInitialStoppedResume: boolean;
  resumeActionErrorMessage: string | null;
  shouldAttemptInitialStoppedResume: boolean;
  isResumingStoppedSandbox: boolean;
  sandboxStatus: SandboxLifecycleStatus | null;
}): boolean {
  return (
    input.sandboxStatus === "stopped" &&
    (input.isResumingStoppedSandbox ||
      input.shouldAttemptInitialStoppedResume ||
      (input.hasAttemptedInitialStoppedResume && input.resumeActionErrorMessage === null))
  );
}

export function shouldPollStoppedSandboxStatus(input: {
  sandboxStatus: SandboxLifecycleStatus | null;
  hasAttemptedInitialStoppedResume: boolean;
  isResumingStoppedSandbox: boolean;
  resumeActionErrorMessage: string | null;
}): boolean {
  return (
    input.sandboxStatus === "stopped" &&
    shouldShowResumeInFlightState({
      hasAttemptedInitialStoppedResume: input.hasAttemptedInitialStoppedResume,
      resumeActionErrorMessage: input.resumeActionErrorMessage,
      shouldAttemptInitialStoppedResume: false,
      isResumingStoppedSandbox: input.isResumingStoppedSandbox,
      sandboxStatus: input.sandboxStatus,
    })
  );
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
    return input.hasResumeInFlightState ? "resume_pending" : "manual_resume_required";
  }

  return "loading";
}

export function resolveSandboxLifecycleStatusForWorkbenchEntryPhase(
  phase: WorkbenchEntryPhase,
): WorkbenchSandboxLifecycleStatus {
  if (phase === "sandbox_failed") {
    return "failed";
  }

  if (phase === "resume_pending") {
    return "resuming";
  }

  if (phase === "sandbox_starting") {
    return "starting";
  }

  if (phase === "connecting" || phase === "ready") {
    return "running";
  }

  if (phase === "manual_resume_required") {
    return "stopped";
  }

  return null;
}

export function resolveStoppedSessionMessageForWorkbenchEntryPhase(input: {
  phase: WorkbenchEntryPhase;
  resumeActionErrorMessage: string | null;
}): string | null {
  if (input.phase !== "manual_resume_required") {
    return null;
  }

  return (
    input.resumeActionErrorMessage ??
    "This sandbox is stopped. Resume it to reconnect chat and terminal."
  );
}
