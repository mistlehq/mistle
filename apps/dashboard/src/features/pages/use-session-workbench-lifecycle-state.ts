import { systemScheduler } from "@mistle/time";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { getSandboxInstanceStatus } from "../sessions/sessions-service.js";
import type { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveSandboxLifecycleStatusForWorkbenchEntryPhase,
  resolveSandboxStatusReadState,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveTrustedSandboxStatus,
  resolveWorkbenchEntryPhase,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldWaitForAutomationSessionThread,
} from "./session-workbench-state.js";
import { useSessionWorkbenchCodexRecovery } from "./use-session-workbench-codex-recovery.js";
import { useSessionWorkbenchStoppedResume } from "./use-session-workbench-stopped-resume.js";

const AutomationSessionStatusRefetchIntervalMs = 2_000;
const AutomationSessionPreparationTimeoutMessage =
  "This chat session is taking longer than expected to become ready. Please try again shortly.";
export function getSandboxInstanceStatusQueryKey(
  sandboxInstanceId: string | null,
): readonly ["sandbox-instance-status", string | null] {
  return ["sandbox-instance-status", sandboxInstanceId];
}

export function useSessionWorkbenchLifecycleState(input: {
  sandboxInstanceId: string | null;
  mainPanelTransitionState: MainPanelTransitionState;
  lifecycle: Pick<
    ReturnType<typeof useCodexSessionState>["lifecycle"],
    | "clearLifecycleErrorMessage"
    | "connectSession"
    | "detachSessionTransport"
    | "disconnectSession"
    | "isStartingSession"
    | "lifecycleErrorMessage"
    | "recoverSession"
    | "recoverableDisconnect"
    | "sessionSnapshot"
    | "transportState"
  >;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  queryClient: QueryClient;
}) {
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const initialSandboxStatusDataUpdatedAtRef = useRef<number | null>(null);
  // Recovery must not trust a cached pre-reset "running" read. Each reset/disconnect
  // records the latest query timestamp and blocks reconnect logic until a newer read lands.
  const recoveryStatusBoundaryDataUpdatedAtRef = useRef<number | null>(null);

  const {
    clearLifecycleErrorMessage,
    connectSession,
    sessionSnapshot,
    disconnectSession,
    isStartingSession,
    lifecycleErrorMessage,
    recoverSession,
    recoverableDisconnect,
    transportState,
  } = input.lifecycle;
  const { disconnectPty } = input.ptyState.actions;
  const handleResumeSucceeded = useCallback(() => {
    setHasAttemptedAutoConnect(false);
  }, []);
  const refetchSandboxStatus = useCallback(
    () =>
      input.queryClient.refetchQueries({
        queryKey: getSandboxInstanceStatusQueryKey(input.sandboxInstanceId),
        exact: true,
      }),
    [input.queryClient, input.sandboxInstanceId],
  );
  const stoppedResumeState = useSessionWorkbenchStoppedResume({
    clearLifecycleErrorMessage,
    onResumeSucceeded: handleResumeSucceeded,
    queryClient: input.queryClient,
    refetchSandboxStatus,
    sandboxInstanceId: input.sandboxInstanceId,
  });

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
          hasAttemptedInitialStoppedResume: stoppedResumeState.hasAttemptedInitialStoppedResume,
          isResumingStoppedSandbox: stoppedResumeState.isResumingStoppedSandbox,
          resumeActionErrorMessage: stoppedResumeState.resumeActionErrorMessage,
        })
      ) {
        return 1_000;
      }

      return status === "running" || status === "failed" || status === "stopped" ? false : 1_000;
    },
  });
  const markRecoveryBoundary = useCallback(() => {
    recoveryStatusBoundaryDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
  }, [sandboxStatusQuery.dataUpdatedAt]);

  if (initialSandboxStatusDataUpdatedAtRef.current === null) {
    initialSandboxStatusDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
  }

  const hasFreshSandboxStatusSinceMount = hasFreshSandboxStatusRead({
    initialDataUpdatedAtMs: initialSandboxStatusDataUpdatedAtRef.current,
    currentDataUpdatedAtMs: sandboxStatusQuery.dataUpdatedAt,
  });
  const hasFreshSandboxStatusSinceRecovery = hasFreshSandboxStatusReadSinceRecoveryBoundary({
    recoveryBoundaryDataUpdatedAtMs: recoveryStatusBoundaryDataUpdatedAtRef.current,
    currentDataUpdatedAtMs: sandboxStatusQuery.dataUpdatedAt,
  });
  const sandboxStatusReadState = resolveSandboxStatusReadState({
    hasFreshSandboxStatusSinceMount,
    hasFreshSandboxStatusSinceRecovery,
    hasStatusQueryError: sandboxStatusQuery.isError,
  });
  const trustedSandboxStatus = resolveTrustedSandboxStatus({
    sandboxStatusReadState,
    sandboxStatus: sandboxStatusQuery.data?.status ?? null,
  });
  const shouldAttemptRecoverableStoppedResume =
    input.sandboxInstanceId !== null &&
    trustedSandboxStatus === "stopped" &&
    recoverableDisconnect !== null;
  const shouldAttemptInitialStoppedResume =
    input.sandboxInstanceId !== null &&
    trustedSandboxStatus === "stopped" &&
    recoverableDisconnect === null &&
    !stoppedResumeState.hasAttemptedInitialStoppedResume;
  const isShowingResumeInFlightState = shouldShowResumeInFlightState({
    hasAttemptedInitialStoppedResume: stoppedResumeState.hasAttemptedInitialStoppedResume,
    resumeActionErrorMessage: stoppedResumeState.resumeActionErrorMessage,
    shouldAttemptInitialStoppedResume:
      shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume,
    isResumingStoppedSandbox: stoppedResumeState.isResumingStoppedSandbox,
    sandboxStatus: trustedSandboxStatus,
  });
  const workbenchEntryPhase = resolveWorkbenchEntryPhase({
    connectedSession: sessionSnapshot !== null,
    hasResumeInFlightState: isShowingResumeInFlightState,
    sandboxStatus: trustedSandboxStatus,
  });
  const displaySandboxLifecycleStatus =
    resolveSandboxLifecycleStatusForWorkbenchEntryPhase(workbenchEntryPhase);
  const automationConversation = sandboxStatusQuery.data?.automationConversation ?? null;
  const isWaitingForAutomationThread = shouldWaitForAutomationSessionThread({
    sandboxStatus: displaySandboxLifecycleStatus,
    automationConversation,
  });
  const connectionReadiness = resolveSessionConnectionReadiness({
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: displaySandboxLifecycleStatus,
    isStatusPending: sandboxStatusQuery.isPending,
  });
  const stoppedSessionMessage = resolveStoppedSessionMessageForWorkbenchEntryPhase({
    phase: workbenchEntryPhase,
    resumeActionErrorMessage: stoppedResumeState.resumeActionErrorMessage,
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
    initialSandboxStatusDataUpdatedAtRef.current = null;
    recoveryStatusBoundaryDataUpdatedAtRef.current = null;
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.mainPanelTransitionState === "stable_chat") {
      setHasAttemptedAutoConnect(false);
    }
  }, [input.mainPanelTransitionState]);

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

    const timeoutHandle = systemScheduler.schedule(() => {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
    }, timeoutDelayMs);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [automationPendingSinceMs, isWaitingForAutomationThread]);

  const resolvedLifecycleErrorMessage = lifecycleErrorMessage ?? automationPendingErrorMessage;
  const codexRecoveryState = useSessionWorkbenchCodexRecovery({
    canConnect: connectionReadiness.canConnect,
    connectSession,
    hasLifecycleError: resolvedLifecycleErrorMessage !== null,
    isStartingSession,
    isWaitingForAutomationThread,
    mainPanelTransitionState: input.mainPanelTransitionState,
    markRecoveryBoundary,
    ptyResetInfo: input.ptyState.lifecycle.resetInfo,
    recoverSession,
    recoverableDisconnect,
    refetchSandboxStatus: sandboxStatusQuery.refetch,
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: displaySandboxLifecycleStatus,
    transportState,
  });

  useEffect(() => {
    if (input.mainPanelTransitionState !== "stable_chat") {
      return;
    }

    if (input.sandboxInstanceId === null) {
      return;
    }

    if (
      !shouldAutoConnectSession({
        sandboxInstanceId: input.sandboxInstanceId,
        canConnect: connectionReadiness.canConnect,
        connected: transportState === "connected",
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
      targetThreadId: automationConversation?.providerConversationId ?? null,
      providerThreadId: automationConversation?.providerConversationId ?? null,
    });
  }, [
    automationConversation,
    connectSession,
    input.mainPanelTransitionState,
    connectionReadiness.canConnect,
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    resolvedLifecycleErrorMessage,
    transportState,
  ]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || sessionSnapshot === null) {
      return;
    }

    if (connectionReadiness.reason !== "starting") {
      return;
    }

    void sandboxStatusQuery.refetch();
  }, [
    connectionReadiness.reason,
    input.sandboxInstanceId,
    sessionSnapshot,
    sandboxStatusQuery.refetch,
  ]);

  const sandboxFailureMessage = sandboxStatusQuery.data?.failureMessage ?? null;
  const requestStoppedSandboxResume = useCallback(
    () =>
      stoppedResumeState.requestStoppedSandboxResume({
        trustedSandboxStatus,
      }),
    [stoppedResumeState.requestStoppedSandboxResume, trustedSandboxStatus],
  );

  return {
    sessionSnapshot,
    sandboxStatusReadState,
    connectionReadiness,
    isResumingStoppedSandbox: isShowingResumeInFlightState,
    requestStoppedSandboxResume,
    sandboxLifecycleStatus: displaySandboxLifecycleStatus,
    sandboxFailureMessage,
    sandboxStatusQuery,
    sessionReconnectState: codexRecoveryState.sessionReconnectState,
    shouldAutoResumeOnEntry:
      shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume,
    lifecycleErrorMessage: resolvedLifecycleErrorMessage,
    stoppedSessionState,
  };
}
