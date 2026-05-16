import { systemScheduler } from "@mistle/time";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import {
  resolveInitialSessionConnectInput,
  type InitialSessionConnectInput,
} from "./session-initial-connect-policy.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { SessionStartupState } from "./session-startup-status.js";
import {
  hasTriggerSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveTriggerSessionPreparationTimeoutDelayMs,
  resolveSessionWorkbenchStatus,
  resolveSandboxLifecycleStatusForWorkbenchEntryPhase,
  resolveSandboxStatusReadState,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveTrustedSandboxStatus,
  resolveWorkbenchEntryPhase,
  shouldWaitForTriggerSessionThread,
} from "./session-workbench-state.js";
import { useSessionWorkbenchRecovery } from "./use-session-workbench-recovery.js";

const TriggerSessionStatusRefetchIntervalMs = 2_000;
const TriggerSessionPreparationTimeoutMessage =
  "This chat session is taking longer than expected to become ready. Please try again shortly.";

type SessionWorkbenchSandboxStatusSnapshot = {
  triggerConversation: SandboxInstanceStatusResult["triggerConversation"];
  connectable: SandboxInstanceStatusResult["connectable"] | null;
  status: SandboxInstanceStatusResult["status"] | null;
};

type SessionSnapshotForWorkbench = {
  activeThreadCwd?: string | null;
  activeThreadId?: string | null;
  connectedAtIso: string;
  providerThreadId?: string | null;
  sandboxInstanceId?: string;
};

export type SessionLifecycleForWorkbench = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: InitialSessionConnectInput) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: { sandboxInstanceId: string; targetThreadId: string | null }) => void;
  recoverableDisconnect: {
    id: number;
    message: string;
    targetThreadId: string | null;
    recoveryStrategy: "reconnect_transport" | "reopen_stream";
  } | null;
  sessionConnectionState: "connected" | "connecting" | "detached" | "recovering";
  sessionSnapshot: SessionSnapshotForWorkbench | null;
};

export function resolveSandboxStatusRefetchInterval(
  input: SessionWorkbenchSandboxStatusSnapshot & {
    isAutoResumingStoppedSandbox: boolean;
  },
): false | number {
  if (
    shouldWaitForTriggerSessionThread({
      sandboxStatus: input.status,
      triggerConversation: input.triggerConversation,
    })
  ) {
    return TriggerSessionStatusRefetchIntervalMs;
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
  resolveLifecycle: (agentRuntimeId: string | null) => SessionLifecycleForWorkbench;
  queryClient: QueryClient;
}) {
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [hasAttemptedAutoResume, setHasAttemptedAutoResume] = useState(false);
  const [isAutoResumingStoppedSandbox, setIsAutoResumingStoppedSandbox] = useState(false);
  const [autoResumeErrorMessage, setAutoResumeErrorMessage] = useState<string | null>(null);
  const [triggerPendingSinceMs, setTriggerPendingSinceMs] = useState<number | null>(null);
  const [triggerPendingErrorMessage, setTriggerPendingErrorMessage] = useState<string | null>(null);
  const initialSandboxStatusDataUpdatedAtRef = useRef<number | null>(null);
  // Recovery must not trust cached status after a reset/disconnect until a recovery-triggered
  // refresh completes after the latest observed recovery event.
  const recoveryRefreshStateRef = useRef({
    boundaryEpoch: 0,
    latestCompletedEpoch: 0,
    inFlight: false,
  });

  const sandboxStatusQuery = useQuery({
    queryKey:
      input.sandboxInstanceId === null
        ? (["sandbox-instance-status", null] as const)
        : sandboxInstanceStatusQueryKey(input.sandboxInstanceId),
    meta: NoLoadingIndicatorMeta,
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
        triggerConversation: query.state.data?.triggerConversation ?? null,
        connectable: query.state.data?.connectable ?? null,
        isAutoResumingStoppedSandbox,
        status: query.state.data?.status ?? null,
      });
    },
  });
  const sandboxStatus = sandboxStatusQuery.data;
  const activeLifecycle = input.resolveLifecycle(
    sandboxStatus?.runtimeContext?.agentRuntimeId ?? null,
  );

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
  } = activeLifecycle;
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
  const triggerConversation = sandboxStatus?.triggerConversation ?? null;
  const providerThreadId = triggerConversation?.providerConversationId ?? null;
  const isWaitingForTriggerThread = shouldWaitForTriggerSessionThread({
    sandboxStatus: displaySandboxLifecycleStatus,
    triggerConversation,
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
    setTriggerPendingSinceMs(null);
    setTriggerPendingErrorMessage(null);
    if (input.sandboxInstanceId === null) {
      initialSandboxStatusDataUpdatedAtRef.current = null;
    } else {
      const queryKey = sandboxInstanceStatusQueryKey(input.sandboxInstanceId);
      initialSandboxStatusDataUpdatedAtRef.current =
        input.queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
      void input.queryClient.refetchQueries({
        queryKey,
        type: "active",
      });
    }
    recoveryRefreshStateRef.current = {
      boundaryEpoch: 0,
      latestCompletedEpoch: 0,
      inFlight: false,
    };
  }, [input.queryClient, input.sandboxInstanceId]);

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
    if (!isWaitingForTriggerThread) {
      setTriggerPendingSinceMs(null);
      setTriggerPendingErrorMessage(null);
      return;
    }

    if (triggerPendingSinceMs === null) {
      setTriggerPendingSinceMs(Date.now());
      return;
    }

    if (
      hasTriggerSessionPreparationTimedOut({
        pendingSinceMs: triggerPendingSinceMs,
        nowMs: Date.now(),
      })
    ) {
      setTriggerPendingErrorMessage(TriggerSessionPreparationTimeoutMessage);
      return;
    }

    const timeoutDelayMs = resolveTriggerSessionPreparationTimeoutDelayMs({
      pendingSinceMs: triggerPendingSinceMs,
      nowMs: Date.now(),
    });

    if (timeoutDelayMs === null) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setTriggerPendingErrorMessage(TriggerSessionPreparationTimeoutMessage);
    }, timeoutDelayMs);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [triggerPendingSinceMs, isWaitingForTriggerThread]);

  const resolvedLifecycleErrorMessage = lifecycleErrorMessage ?? triggerPendingErrorMessage;
  const sessionRecoveryState = useSessionWorkbenchRecovery({
    canConnect: connectionReadiness.canConnect,
    connectSession,
    hasLifecycleError: resolvedLifecycleErrorMessage !== null,
    isStartingSession,
    isWaitingForTriggerThread,
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

    if (isWaitingForTriggerThread) {
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
    isWaitingForTriggerThread,
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
  const sessionReconnectMessage = sessionRecoveryState.sessionReconnectState.message;
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
  sessionSnapshot: SessionSnapshotForWorkbench | null;
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
