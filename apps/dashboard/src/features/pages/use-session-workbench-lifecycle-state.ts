import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  hasSessionTopAlert,
  resolveSessionHeaderStatusUi,
} from "./session-workbench-view-model.js";

const AutomationSessionStatusRefetchIntervalMs = 2_000;
const AutomationSessionPreparationTimeoutMs = 30_000;
const AutomationSessionPreparationTimeoutMessage =
  "This chat session is taking longer than expected to become ready. Please try again shortly.";

type SandboxAutomationConversation = {
  conversationId: string;
  routeId: string | null;
  providerConversationId: string | null;
} | null;

type ResumeRequestGuard = {
  requestId: number;
  sandboxInstanceId: string;
};

type SessionEntryPhase =
  | "connecting"
  | "sandbox_failed"
  | "loading"
  | "manual_resume_required"
  | "ready"
  | "resume_pending"
  | "sandbox_starting";

function resolveSandboxStatusForEntryPhase(
  phase: SessionEntryPhase,
): "resuming" | "starting" | "running" | "stopped" | "failed" | null {
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

function resolveResumeFailureMessage(error: unknown): string {
  if (error instanceof SandboxProfilesApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Could not resume sandbox session.";
}

export function shouldWaitForAutomationSessionThread(input: {
  sandboxStatus: string | null;
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

  return input.nowMs - input.pendingSinceMs >= AutomationSessionPreparationTimeoutMs;
}

export function resolveAutomationSessionPreparationTimeoutDelayMs(input: {
  pendingSinceMs: number | null;
  nowMs: number;
}): number | null {
  if (input.pendingSinceMs === null) {
    return null;
  }

  const remainingMs = AutomationSessionPreparationTimeoutMs - (input.nowMs - input.pendingSinceMs);
  return remainingMs > 0 ? remainingMs : 0;
}

export function getSandboxInstanceStatusQueryKey(
  sandboxInstanceId: string | null,
): readonly ["sandbox-instance-status", string | null] {
  return ["sandbox-instance-status", sandboxInstanceId];
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

export function shouldShowResumeInFlightState(input: {
  hasAttemptedInitialStoppedResume: boolean;
  resumeActionErrorMessage: string | null;
  shouldAttemptInitialStoppedResume: boolean;
  isResumingStoppedSandbox: boolean;
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
}): boolean {
  return (
    input.sandboxStatus === "stopped" &&
    (input.isResumingStoppedSandbox ||
      input.shouldAttemptInitialStoppedResume ||
      (input.hasAttemptedInitialStoppedResume && input.resumeActionErrorMessage === null))
  );
}

export function shouldPollStoppedSandboxStatus(input: {
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
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

export function resolveSessionEntryPhase(input: {
  connectedSession: boolean;
  hasResumeInFlightState: boolean;
  isStatusPending: boolean;
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
}): SessionEntryPhase {
  if (input.sandboxStatus === "failed") {
    return "sandbox_failed";
  }

  if (input.sandboxStatus === "running") {
    return input.connectedSession ? "ready" : "connecting";
  }

  if (input.sandboxStatus === "starting") {
    return "sandbox_starting";
  }

  if (input.sandboxStatus === "stopped") {
    return input.hasResumeInFlightState ? "resume_pending" : "manual_resume_required";
  }

  return "loading";
}

export function resolveStoppedSessionMessageForEntryPhase(input: {
  phase: SessionEntryPhase;
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

export function isActiveResumeRequest(input: {
  activeRequest: ResumeRequestGuard | null;
  requestId: number;
  sandboxInstanceId: string;
}): boolean {
  return (
    input.activeRequest !== null &&
    input.activeRequest.requestId === input.requestId &&
    input.activeRequest.sandboxInstanceId === input.sandboxInstanceId
  );
}

export function seedSandboxInstanceStatusQuery(input: {
  queryClient: QueryClient;
  sandboxInstanceId: string;
  sandboxStatus: Awaited<ReturnType<typeof getSandboxInstanceStatus>>;
}): void {
  input.queryClient.setQueryData(
    getSandboxInstanceStatusQueryKey(input.sandboxInstanceId),
    input.sandboxStatus,
  );
}

export function useSessionWorkbenchLifecycleState(input: {
  sandboxInstanceId: string | null;
  lifecycle: Pick<
    ReturnType<typeof useCodexSessionState>["lifecycle"],
    | "agentConnectionState"
    | "clearLifecycleErrorMessage"
    | "connectSession"
    | "connectedSession"
    | "disconnectSession"
    | "isStartingSession"
    | "lifecycleErrorMessage"
    | "step"
  >;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  queryClient: QueryClient;
}) {
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const [hasAttemptedInitialStoppedResume, setHasAttemptedInitialStoppedResume] = useState(false);
  const [isResumingStoppedSandbox, setIsResumingStoppedSandbox] = useState(false);
  const [resumeActionErrorMessage, setResumeActionErrorMessage] = useState<string | null>(null);
  const activeResumeRequestRef = useRef<ResumeRequestGuard | null>(null);
  const resumeIdempotencyKeyRef = useRef<string | null>(null);
  const nextResumeRequestIdRef = useRef(0);
  const initialSandboxStatusDataUpdatedAtRef = useRef<number | null>(null);

  const {
    agentConnectionState,
    clearLifecycleErrorMessage,
    connectSession,
    connectedSession,
    disconnectSession,
    isStartingSession,
    lifecycleErrorMessage,
    step,
  } = input.lifecycle;
  const { disconnectPty } = input.ptyState.actions;

  const sandboxStatusQuery = useQuery({
    queryKey: getSandboxInstanceStatusQueryKey(input.sandboxInstanceId),
    queryFn: async ({ signal }) => {
      if (input.sandboxInstanceId === null) {
        throw new Error("Session id is required.");
      }

      return getSandboxInstanceStatus({
        instanceId: input.sandboxInstanceId,
        signal,
      });
    },
    enabled: input.sandboxInstanceId !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const automationConversation = query.state.data?.automationConversation ?? null;
      if (
        shouldWaitForAutomationSessionThread({
          sandboxStatus: status ?? null,
          automationConversation,
        })
      ) {
        return AutomationSessionStatusRefetchIntervalMs;
      }

      if (
        shouldPollStoppedSandboxStatus({
          sandboxStatus: status ?? null,
          hasAttemptedInitialStoppedResume,
          isResumingStoppedSandbox,
          resumeActionErrorMessage,
        })
      ) {
        return 1_000;
      }

      return status === "running" || status === "failed" || status === "stopped" ? false : 1_000;
    },
  });

  if (initialSandboxStatusDataUpdatedAtRef.current === null) {
    initialSandboxStatusDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
  }

  const hasFreshSandboxStatus = hasFreshSandboxStatusRead({
    initialDataUpdatedAtMs: initialSandboxStatusDataUpdatedAtRef.current,
    currentDataUpdatedAtMs: sandboxStatusQuery.dataUpdatedAt,
  });
  const sandboxStatus = hasFreshSandboxStatus ? (sandboxStatusQuery.data?.status ?? null) : null;
  const shouldAttemptInitialStoppedResume =
    input.sandboxInstanceId !== null &&
    sandboxStatus === "stopped" &&
    !hasAttemptedInitialStoppedResume;
  const isShowingResumeInFlightState = shouldShowResumeInFlightState({
    hasAttemptedInitialStoppedResume,
    resumeActionErrorMessage,
    shouldAttemptInitialStoppedResume,
    isResumingStoppedSandbox,
    sandboxStatus,
  });
  const sessionEntryPhase = resolveSessionEntryPhase({
    connectedSession: connectedSession !== null,
    hasResumeInFlightState: isShowingResumeInFlightState,
    isStatusPending: sandboxStatusQuery.isPending,
    sandboxStatus,
  });
  const effectiveSandboxStatus = resolveSandboxStatusForEntryPhase(sessionEntryPhase);
  const automationConversation = sandboxStatusQuery.data?.automationConversation ?? null;
  const isWaitingForAutomationThread = shouldWaitForAutomationSessionThread({
    sandboxStatus: effectiveSandboxStatus,
    automationConversation,
  });
  const connectionReadiness = resolveSessionConnectionReadiness({
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: effectiveSandboxStatus,
    isStatusPending: sandboxStatusQuery.isPending,
  });
  const stoppedSessionMessage = resolveStoppedSessionMessageForEntryPhase({
    phase: sessionEntryPhase,
    resumeActionErrorMessage,
  });
  const stoppedSessionState = {
    message: stoppedSessionMessage,
    requiresManualResume: stoppedSessionMessage !== null,
  };

  useEffect(() => {
    return () => {
      clearLifecycleErrorMessage();
      disconnectSession();
      void disconnectPty();
    };
  }, [clearLifecycleErrorMessage, disconnectPty, disconnectSession]);

  useEffect(() => {
    setHasAttemptedAutoConnect(false);
    setAutomationPendingSinceMs(null);
    setAutomationPendingErrorMessage(null);
    setHasAttemptedInitialStoppedResume(false);
    setIsResumingStoppedSandbox(false);
    setResumeActionErrorMessage(null);
    activeResumeRequestRef.current = null;
    resumeIdempotencyKeyRef.current = null;
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (!isWaitingForAutomationThread) {
      setAutomationPendingSinceMs(null);
      setAutomationPendingErrorMessage(null);
      return;
    }

    if (automationPendingSinceMs === null) {
      setAutomationPendingSinceMs(Date.now());
      return;
    }

    if (
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: automationPendingSinceMs,
        nowMs: Date.now(),
      })
    ) {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
      return;
    }

    const timeoutDelayMs = resolveAutomationSessionPreparationTimeoutDelayMs({
      pendingSinceMs: automationPendingSinceMs,
      nowMs: Date.now(),
    });

    if (timeoutDelayMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
    }, timeoutDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [automationPendingSinceMs, isWaitingForAutomationThread]);

  const resolvedLifecycleErrorMessage = lifecycleErrorMessage ?? automationPendingErrorMessage;

  useEffect(() => {
    if (input.sandboxInstanceId === null) {
      return;
    }

    if (
      !shouldAutoConnectSession({
        sandboxInstanceId: input.sandboxInstanceId,
        canConnect: connectionReadiness.canConnect,
        connected: connectedSession !== null,
        isStartingSession,
        hasAttemptedAutoConnect,
        hasStartError: resolvedLifecycleErrorMessage !== null,
      })
    ) {
      return;
    }

    if (isWaitingForAutomationThread) {
      return;
    }

    setHasAttemptedAutoConnect(true);
    connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      preferredThreadId: automationConversation?.providerConversationId ?? null,
    });
  }, [
    automationConversation,
    connectSession,
    connectedSession,
    connectionReadiness.canConnect,
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    resolvedLifecycleErrorMessage,
  ]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || connectedSession === null) {
      return;
    }

    if (connectionReadiness.reason !== "starting") {
      return;
    }

    void sandboxStatusQuery.refetch();
  }, [
    connectedSession,
    connectionReadiness.reason,
    input.sandboxInstanceId,
    sandboxStatusQuery.refetch,
  ]);

  const sandboxStatusLabel =
    effectiveSandboxStatus ?? (sandboxStatusQuery.isPending ? "Loading" : "Unknown");
  const sessionHeaderStatusUi = resolveSessionHeaderStatusUi({
    sandboxStatus: sandboxStatusLabel.toLowerCase(),
    agentConnectionState,
    step,
    hasConnectionError: resolvedLifecycleErrorMessage !== null,
  });
  const sandboxFailureMessage = sandboxStatusQuery.data?.failureMessage ?? null;
  const hasTopAlert = hasSessionTopAlert({
    hasSandboxStatusError: sandboxStatusQuery.isError,
    lifecycleErrorMessage: resolvedLifecycleErrorMessage,
    sandboxFailureMessage,
    stoppedSessionMessage: stoppedSessionState.message,
  });

  const requestStoppedSandboxResume = useCallback(async (): Promise<void> => {
    if (
      input.sandboxInstanceId === null ||
      sandboxStatus !== "stopped" ||
      isResumingStoppedSandbox
    ) {
      return;
    }

    const idempotencyKey = resumeIdempotencyKeyRef.current ?? crypto.randomUUID();
    resumeIdempotencyKeyRef.current = idempotencyKey;
    const requestId = nextResumeRequestIdRef.current + 1;
    nextResumeRequestIdRef.current = requestId;
    activeResumeRequestRef.current = {
      requestId,
      sandboxInstanceId: input.sandboxInstanceId,
    };
    setHasAttemptedInitialStoppedResume(true);
    setResumeActionErrorMessage(null);

    clearLifecycleErrorMessage();
    setIsResumingStoppedSandbox(true);
    try {
      const resumedSandboxStatus = await resumeSandboxInstance({
        instanceId: input.sandboxInstanceId,
        idempotencyKey,
      });
      if (
        !isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        return;
      }
      seedSandboxInstanceStatusQuery({
        queryClient: input.queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: resumedSandboxStatus,
      });
      if (resumedSandboxStatus.status !== "stopped") {
        resumeIdempotencyKeyRef.current = null;
      }
      clearLifecycleErrorMessage();
      setHasAttemptedAutoConnect(false);

      void sandboxStatusQuery.refetch().catch(() => {});
    } catch (error) {
      if (
        !isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        return;
      }
      if (error instanceof SandboxProfilesApiError && error.status < 500) {
        resumeIdempotencyKeyRef.current = null;
      }
      setResumeActionErrorMessage(resolveResumeFailureMessage(error));
    } finally {
      if (
        isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        activeResumeRequestRef.current = null;
        setIsResumingStoppedSandbox(false);
      }
    }
  }, [
    clearLifecycleErrorMessage,
    input.queryClient,
    input.sandboxInstanceId,
    isResumingStoppedSandbox,
    sandboxStatus,
    sandboxStatusQuery.refetch,
  ]);

  return {
    connectedSession,
    connectionReadiness,
    hasTopAlert,
    isResumingStoppedSandbox: isShowingResumeInFlightState,
    requestStoppedSandboxResume,
    sandboxFailureMessage,
    sandboxStatusQuery,
    sessionHeaderStatusUi,
    shouldAutoResumeOnEntry: shouldAttemptInitialStoppedResume,
    lifecycleErrorMessage: resolvedLifecycleErrorMessage,
    stoppedSessionState,
  };
}
