import { systemScheduler } from "@mistle/time";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import {
  AppShellLoadingIndicatorMeta,
  AppShellLoadingIndicators,
} from "../shell/app-shell-loading-indicator-meta.js";
import { resolveInitialSessionConnectInput } from "./session-initial-connect-policy.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { SessionStartupState } from "./session-startup-status.js";
import {
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveSessionWorkbenchStatus,
  resolveSandboxLifecycleStatusForWorkbenchEntryPhase,
  resolveSandboxStatusReadState,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveTrustedSandboxStatus,
  resolveWorkbenchEntryPhase,
  shouldWaitForAutomationSessionThread,
} from "./session-workbench-state.js";
import { useSessionWorkbenchCodexRecovery } from "./use-session-workbench-codex-recovery.js";

const AutomationSessionStatusRefetchIntervalMs = 2_000;
const AutomationSessionPreparationTimeoutMessage =
  "This chat session is taking longer than expected to become ready. Please try again shortly.";

type SessionWorkbenchSandboxStatusSnapshot = {
  automationConversation: SandboxInstanceStatusResult["automationConversation"];
  connectable: SandboxInstanceStatusResult["connectable"] | null;
  status: SandboxInstanceStatusResult["status"] | null;
};

export function resolveSandboxStatusRefetchInterval(
  input: SessionWorkbenchSandboxStatusSnapshot & {
    isAutoResumingStoppedSandbox: boolean;
  },
): false | number {
  if (
    shouldWaitForAutomationSessionThread({
      sandboxStatus: input.status,
      automationConversation: input.automationConversation,
    })
  ) {
    return AutomationSessionStatusRefetchIntervalMs;
  }

  if (input.isAutoResumingStoppedSandbox && input.status === "stopped") {
    return 1_000;
  }

  if (input.connectable === true) {
    return false;
  }

  return input.status === "failed" || input.status === "stopped" ? false : 1_000;
}

export function useSessionWorkbenchLifecycleState(input: {
  sandboxInstanceId: string | null;
  mainPanelTransitionState: MainPanelTransitionState;
  lifecycle: Pick<
    ReturnType<typeof useCodexSessionState>["lifecycle"],
    | "clearLifecycleErrorMessage"
    | "connectSession"
    | "detachSessionConnection"
    | "disconnectSession"
    | "isStartingSession"
    | "lifecycleErrorMessage"
    | "recoverSession"
    | "recoverableDisconnect"
    | "sessionSnapshot"
    | "sessionConnectionState"
  >;
  queryClient: QueryClient;
}) {
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [hasAttemptedAutoResume, setHasAttemptedAutoResume] = useState(false);
  const [isAutoResumingStoppedSandbox, setIsAutoResumingStoppedSandbox] = useState(false);
  const [autoResumeErrorMessage, setAutoResumeErrorMessage] = useState<string | null>(null);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const initialSandboxStatusDataUpdatedAtRef = useRef<number | null>(null);
  // Recovery must not trust cached status after a reset/disconnect until a recovery-triggered
  // refresh completes after the latest observed recovery event.
  const recoveryRefreshStateRef = useRef({
    boundaryEpoch: 0,
    latestCompletedEpoch: 0,
    inFlight: false,
  });

  const {
    clearLifecycleErrorMessage,
    connectSession,
    sessionSnapshot,
    disconnectSession,
    isStartingSession,
    lifecycleErrorMessage,
    recoverSession,
    recoverableDisconnect,
    sessionConnectionState,
  } = input.lifecycle;
  const sandboxStatusQuery = useQuery({
    queryKey:
      input.sandboxInstanceId === null
        ? (["sandbox-instance-status", null] as const)
        : sandboxInstanceStatusQueryKey(input.sandboxInstanceId),
    meta: {
      [AppShellLoadingIndicatorMeta.INDICATOR]: AppShellLoadingIndicators.NONE,
    },
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
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (query) => {
      return resolveSandboxStatusRefetchInterval({
        automationConversation: query.state.data?.automationConversation ?? null,
        connectable: query.state.data?.connectable ?? null,
        isAutoResumingStoppedSandbox,
        status: query.state.data?.status ?? null,
      });
    },
  });
  const requestRecoveryStatusRefresh = useCallback((): void => {
    const refreshState = recoveryRefreshStateRef.current;
    refreshState.boundaryEpoch += 1;

    const startRefresh = (epoch: number): void => {
      refreshState.inFlight = true;

      void sandboxStatusQuery
        .refetch()
        .then(() => {
          refreshState.latestCompletedEpoch = Math.max(refreshState.latestCompletedEpoch, epoch);
        })
        .catch(() => {})
        .finally(() => {
          if (refreshState.boundaryEpoch > epoch) {
            startRefresh(refreshState.boundaryEpoch);
            return;
          }

          refreshState.inFlight = false;
        });
    };

    if (refreshState.inFlight) {
      return;
    }

    startRefresh(refreshState.boundaryEpoch);
  }, [sandboxStatusQuery.refetch]);

  const handleTerminalWorkspaceReset = useCallback((): void => {
    requestRecoveryStatusRefresh();
  }, [requestRecoveryStatusRefresh]);

  if (initialSandboxStatusDataUpdatedAtRef.current === null) {
    initialSandboxStatusDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
  }

  const hasFreshSandboxStatusSinceMount = hasFreshSandboxStatusRead({
    initialDataUpdatedAtMs: initialSandboxStatusDataUpdatedAtRef.current,
    currentDataUpdatedAtMs: sandboxStatusQuery.dataUpdatedAt,
  });
  const hasFreshSandboxStatusSinceRecovery = hasFreshSandboxStatusReadSinceRecoveryBoundary({
    recoveryBoundaryEpoch:
      recoveryRefreshStateRef.current.boundaryEpoch === 0
        ? null
        : recoveryRefreshStateRef.current.boundaryEpoch,
    latestCompletedRecoveryRefreshEpoch: recoveryRefreshStateRef.current.latestCompletedEpoch,
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
  const shouldAttemptAutoResume =
    input.sandboxInstanceId !== null &&
    trustedSandboxStatus === "stopped" &&
    !hasAttemptedAutoResume;
  const workbenchEntryPhase = resolveWorkbenchEntryPhase({
    connectedSession: sessionSnapshot !== null,
    hasResumeInFlightState: shouldAttemptAutoResume || isAutoResumingStoppedSandbox,
    sandboxStatus: trustedSandboxStatus,
  });
  const displaySandboxLifecycleStatus =
    resolveSandboxLifecycleStatusForWorkbenchEntryPhase(workbenchEntryPhase);
  const sandboxStatus = sandboxStatusQuery.data;
  const automationConversation = sandboxStatus?.automationConversation ?? null;
  const providerThreadId = automationConversation?.providerConversationId ?? null;
  const isWaitingForAutomationThread = shouldWaitForAutomationSessionThread({
    sandboxStatus: displaySandboxLifecycleStatus,
    automationConversation,
  });
  const connectionReadiness = resolveSessionConnectionReadiness({
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: displaySandboxLifecycleStatus,
    sandboxConnectable: sandboxStatus?.connectable ?? null,
    isStatusPending: sandboxStatusQuery.isPending,
  });
  const stoppedSessionMessage = resolveStoppedSessionMessageForWorkbenchEntryPhase({
    autoResumeErrorMessage,
    phase: workbenchEntryPhase,
  });

  useEffect(() => {
    return () => {
      clearLifecycleErrorMessage();
      disconnectSession();
    };
  }, [clearLifecycleErrorMessage, disconnectSession]);

  useEffect(() => {
    setHasAttemptedAutoConnect(false);
    setHasAttemptedAutoResume(false);
    setIsAutoResumingStoppedSandbox(false);
    setAutoResumeErrorMessage(null);
    setAutomationPendingSinceMs(null);
    setAutomationPendingErrorMessage(null);
    initialSandboxStatusDataUpdatedAtRef.current = null;
    recoveryRefreshStateRef.current = {
      boundaryEpoch: 0,
      latestCompletedEpoch: 0,
      inFlight: false,
    };
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.mainPanelTransitionState === "stable_chat") {
      setHasAttemptedAutoConnect(false);
    }
  }, [input.mainPanelTransitionState]);

  useEffect(() => {
    if (!shouldAttemptAutoResume || input.sandboxInstanceId === null) {
      return;
    }

    const sandboxInstanceId = input.sandboxInstanceId;
    let isActive = true;
    setHasAttemptedAutoResume(true);
    setIsAutoResumingStoppedSandbox(true);
    setAutoResumeErrorMessage(null);
    clearLifecycleErrorMessage();

    void resumeSandboxInstance({
      instanceId: sandboxInstanceId,
    })
      .then((sandboxStatus) => {
        if (!isActive) {
          return;
        }

        input.queryClient.setQueryData(
          sandboxInstanceStatusQueryKey(sandboxInstanceId),
          sandboxStatus,
        );
        setHasAttemptedAutoConnect(false);
        clearLifecycleErrorMessage();
        void sandboxStatusQuery.refetch().catch(() => {});
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setAutoResumeErrorMessage(
          error instanceof Error && error.message.length > 0
            ? error.message
            : "Could not resume sandbox session.",
        );
      })
      .finally(() => {
        if (!isActive) {
          return;
        }

        setIsAutoResumingStoppedSandbox(false);
      });

    return () => {
      isActive = false;
    };
  }, [
    clearLifecycleErrorMessage,
    input.queryClient,
    input.sandboxInstanceId,
    sandboxStatusQuery,
    shouldAttemptAutoResume,
  ]);

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
    requestRecoveryStatusRefresh,
    recoverSession,
    recoverableDisconnect,
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus: displaySandboxLifecycleStatus,
    sessionConnectionState,
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
        connected: sessionConnectionState === "connected",
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

    const connectInput = resolveInitialSessionConnectInput({
      connectable: sandboxStatus?.connectable ?? null,
      providerThreadId,
      runtimeContext: sandboxStatus?.runtimeContext ?? null,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    setHasAttemptedAutoConnect(true);
    connectSession(connectInput);
  }, [
    connectSession,
    input.mainPanelTransitionState,
    connectionReadiness.canConnect,
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    resolvedLifecycleErrorMessage,
    providerThreadId,
    sandboxStatus?.runtimeContext,
    sandboxStatus?.connectable,
    sessionConnectionState,
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

  const sandboxFailureMessage = sandboxStatus?.failureMessage ?? null;
  const sessionReconnectMessage = codexRecoveryState.sessionReconnectState.message;
  const workbenchStatus = resolveSessionWorkbenchStatus({
    sandboxStatusReadState,
    sandboxLifecycleStatus: displaySandboxLifecycleStatus,
    lifecycleErrorMessage: resolvedLifecycleErrorMessage,
    reconnectMessage: sessionReconnectMessage,
    sandboxFailureMessage,
    stoppedSessionMessage,
  });
  const initialEntryStartupState = resolveInitialEntryStartupState({
    mainPanelTransitionState: input.mainPanelTransitionState,
    rawSandboxStatus: sandboxStatus?.status ?? null,
    sandboxStatusReadState,
    sessionSnapshot,
  });

  return {
    handleTerminalWorkspaceReset,
    initialEntryStartupState,
    sessionSnapshot,
    sandboxStatusReadState,
    connectionReadiness,
    sandboxLifecycleStatus: displaySandboxLifecycleStatus,
    workbenchStatus,
    sandboxStatusQuery,
    stoppedSessionMessage,
  };
}

export function resolveInitialEntryStartupState(input: {
  mainPanelTransitionState: MainPanelTransitionState;
  rawSandboxStatus: SandboxInstanceStatusResult["status"] | null;
  sandboxStatusReadState: "error" | "loading" | "ready";
  sessionSnapshot: ReturnType<typeof useCodexSessionState>["lifecycle"]["sessionSnapshot"];
}): SessionStartupState | null {
  if (input.sessionSnapshot !== null && input.mainPanelTransitionState === "stable_chat") {
    return null;
  }

  if (input.sandboxStatusReadState === "loading") {
    return "loading_status";
  }

  if (input.sandboxStatusReadState === "error") {
    return null;
  }

  if (input.rawSandboxStatus === "pending") {
    return "preparing_sandbox";
  }

  if (input.rawSandboxStatus === "starting") {
    return "running_setup";
  }

  if (
    input.rawSandboxStatus === "running" &&
    (input.sessionSnapshot === null || input.mainPanelTransitionState !== "stable_chat")
  ) {
    return "connecting_chat";
  }

  return null;
}
