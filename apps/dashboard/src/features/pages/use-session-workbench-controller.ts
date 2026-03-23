import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { getSandboxInstanceStatus } from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  hasSessionTopAlert,
  resolveChatComposerAction,
  resolveSessionHeaderStatusUi,
  resolveStoppedSessionMessage,
} from "./session-workbench-view-model.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";

type ComposerConfigSnapshot = {
  model: string | null;
  modelReasoningEffort: string | null;
};

type ComposerConfigDraft = ComposerConfigSnapshot & {
  baseConfigJson: string | null;
};

const AutomationSessionStatusRefetchIntervalMs = 2_000;
const AutomationSessionPreparationTimeoutMs = 30_000;
const AutomationSessionPreparationTimeoutMessage =
  "This chat session is taking longer than expected to become ready. Please try again shortly.";

type SandboxAutomationConversation = {
  conversationId: string;
  routeId: string | null;
  providerConversationId: string | null;
} | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readComposerConfigSnapshot(configJson: string | null): ComposerConfigSnapshot {
  if (configJson === null) {
    return {
      model: null,
      modelReasoningEffort: null,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(configJson);
  } catch {
    return {
      model: null,
      modelReasoningEffort: null,
    };
  }

  if (!isRecord(parsedJson)) {
    return {
      model: null,
      modelReasoningEffort: null,
    };
  }

  const model = parsedJson["model"];
  const modelReasoningEffort = parsedJson["model_reasoning_effort"];

  return {
    model: typeof model === "string" ? model : null,
    modelReasoningEffort: typeof modelReasoningEffort === "string" ? modelReasoningEffort : null,
  };
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

type SessionWorkbenchState = {
  connectionReadiness: {
    canConnect: boolean;
    reason: "failed" | "loading" | "missing-session" | "ready" | "starting" | "stopped" | "unknown";
  };
  stoppedSessionState: {
    message: string | null;
    requiresManualResume: boolean;
  };
  hasTopAlert: boolean;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  sandboxFailureMessage: string | null;
  sandboxStatusQuery: ReturnType<
    typeof useQuery<Awaited<ReturnType<typeof getSandboxInstanceStatus>>, Error>
  >;
  sessionHeaderStatusUi: ReturnType<typeof resolveSessionHeaderStatusUi>;
  startErrorMessage: string | null;
  terminalPanelState: {
    closePanel: () => void;
    isVisible: boolean;
    openPanel: () => void;
    panelSize: number;
    setPanelSize: (size: number) => void;
    togglePanel: () => void;
  };
  moreActionsState: {
    agentConnectionState: ReturnType<
      typeof useCodexSessionState
    >["lifecycle"]["agentConnectionState"];
    configJson: string | null;
    configRequirementsJson: string | null;
    connectedSession: ReturnType<typeof useCodexSessionState>["lifecycle"]["connectedSession"];
    isReadingConfig: boolean;
    isReadingConfigRequirements: boolean;
    loadConfigSetup: () => void;
  };
};

type SessionConversationPaneState = {
  chatState: ReturnType<typeof useCodexSessionState>["chat"]["chatState"];
  composerProps: {
    canInterruptTurn: boolean;
    canSteerTurn: boolean;
    completedErrorMessage: string | null;
    composerText: string;
    isConnected: boolean;
    isInterruptingTurn: boolean;
    isStartingTurn: boolean;
    isSteeringTurn: boolean;
    isUpdatingComposerConfig: boolean;
    modelOptions: Array<{
      value: string;
      label: string;
    }>;
    onComposerTextChange: (nextText: string) => void;
    onModelChange: (nextModel: string) => void;
    onReasoningEffortChange: (nextReasoningEffort: string) => void;
    onSubmit: () => void;
    selectedModel: string | null;
    selectedReasoningEffort: string | null;
  };
  serverRequestsState: {
    isRespondingToServerRequest: boolean;
    pendingServerRequests: ReturnType<
      typeof useCodexSessionState
    >["serverRequests"]["pendingServerRequests"];
    respondToServerRequest: (requestId: string | number, result: unknown) => void;
  };
};

type UseSessionWorkbenchControllerResult = {
  workbench: SessionWorkbenchState;
  conversationPane: SessionConversationPaneState;
};

export type {
  SessionConversationPaneState,
  SessionWorkbenchState,
  UseSessionWorkbenchControllerResult,
};

export function useSessionWorkbenchController(input: {
  sandboxInstanceId: string | null;
}): UseSessionWorkbenchControllerResult {
  const [composerText, setComposerText] = useState("");
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const [composerConfigDraft, setComposerConfigDraft] = useState<ComposerConfigDraft | null>(null);
  const sessionState = useCodexSessionState();
  const ptyState = useSandboxPtyState();
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const { disconnectPty } = ptyState.actions;
  const lifecycle = sessionState.lifecycle;
  const chat = sessionState.chat;
  const admin = sessionState.admin;
  const serverRequests = sessionState.serverRequests;
  const {
    agentConnectionState,
    clearStartErrorMessage,
    connectSession,
    connectedSession,
    disconnectSession,
    isStartingSession,
    startErrorMessage,
    step,
  } = lifecycle;
  const { canInterruptTurn, canSteerTurn, interruptTurn, startTurn, steerTurn } = chat;
  const { batchWriteConfig, loadModels, readConfig, readConfigRequirements, writeConfigValue } =
    admin;
  const composerConfigSnapshot =
    connectedSession === null
      ? {
          model: null,
          modelReasoningEffort: null,
        }
      : readComposerConfigSnapshot(admin.configJson);
  const activeComposerConfig =
    connectedSession !== null &&
    composerConfigDraft !== null &&
    composerConfigDraft.baseConfigJson === admin.configJson
      ? {
          model: composerConfigDraft.model,
          modelReasoningEffort: composerConfigDraft.modelReasoningEffort,
        }
      : composerConfigSnapshot;

  const sandboxStatusQuery = useQuery({
    queryKey: ["sandbox-instance-status", input.sandboxInstanceId],
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
      if (automationPendingErrorMessage !== null) {
        return false;
      }

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

      return status === "running" || status === "failed" || status === "stopped" ? false : 1_000;
    },
  });
  const sandboxStatus = sandboxStatusQuery.data?.status ?? null;
  const automationConversation = sandboxStatusQuery.data?.automationConversation ?? null;
  const isWaitingForAutomationThread = shouldWaitForAutomationSessionThread({
    sandboxStatus,
    automationConversation,
  });
  const connectionReadiness = resolveSessionConnectionReadiness({
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus,
    isStatusPending: sandboxStatusQuery.isPending,
  });
  const stoppedSessionMessage = resolveStoppedSessionMessage({
    connectionReadinessReason: connectionReadiness.reason,
  });
  const stoppedSessionState = {
    // Mirror the policy contract: stopped-state messaging stays separate from
    // connection readiness until the control-plane API exposes a dedicated
    // resume sandbox endpoint and the dashboard adopts that endpoint as the
    // supported resume flow.
    message: stoppedSessionMessage,
    requiresManualResume: stoppedSessionMessage !== null,
  };

  useEffect(() => {
    setHasAttemptedAutoConnect(false);
    setAutomationPendingSinceMs(null);
    setAutomationPendingErrorMessage(null);
    clearStartErrorMessage();
    disconnectSession();
    void disconnectPty();
  }, [clearStartErrorMessage, disconnectPty, disconnectSession, input.sandboxInstanceId]);

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
      automationPendingErrorMessage === null &&
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: automationPendingSinceMs,
        nowMs: Date.now(),
      })
    ) {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
    }
  }, [automationPendingErrorMessage, automationPendingSinceMs, isWaitingForAutomationThread]);

  const resolvedStartErrorMessage = startErrorMessage ?? automationPendingErrorMessage;

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
        hasStartError: resolvedStartErrorMessage !== null,
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
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    connectionReadiness.canConnect,
    resolvedStartErrorMessage,
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
    sandboxStatus ?? (sandboxStatusQuery.isPending ? "Loading" : "Unknown");
  const sessionHeaderStatusUi = resolveSessionHeaderStatusUi({
    sandboxStatus: sandboxStatusLabel.toLowerCase(),
    agentConnectionState,
    step,
    hasConnectionError: resolvedStartErrorMessage !== null,
  });

  const hasActiveTurn = canInterruptTurn || canSteerTurn;
  const sandboxFailureMessage = sandboxStatusQuery.data?.failureMessage ?? null;
  const hasTopAlert = hasSessionTopAlert({
    hasSandboxStatusError: sandboxStatusQuery.isError,
    startErrorMessage: resolvedStartErrorMessage,
    sandboxFailureMessage,
    stoppedSessionMessage: stoppedSessionState.message,
  });
  const loadConfigSetup = useCallback((): void => {
    readConfig(true);
    readConfigRequirements();
  }, [readConfig, readConfigRequirements]);

  useEffect(() => {
    if (connectedSession === null) {
      return;
    }

    loadModels();
    readConfig(false);
  }, [connectedSession, loadModels, readConfig]);

  const setComposerModel = useCallback(
    (nextModel: string): void => {
      setComposerConfigDraft((currentDraft) => ({
        baseConfigJson: admin.configJson,
        model: nextModel,
        modelReasoningEffort:
          currentDraft?.baseConfigJson === admin.configJson
            ? currentDraft.modelReasoningEffort
            : composerConfigSnapshot.modelReasoningEffort,
      }));
      batchWriteConfig({
        edits: [
          {
            keyPath: "model",
            value: nextModel,
            mergeStrategy: "replace",
          },
        ],
      });
    },
    [admin.configJson, batchWriteConfig, composerConfigSnapshot.modelReasoningEffort],
  );

  const setComposerReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      setComposerConfigDraft((currentDraft) => ({
        baseConfigJson: admin.configJson,
        model:
          currentDraft?.baseConfigJson === admin.configJson
            ? currentDraft.model
            : composerConfigSnapshot.model,
        modelReasoningEffort: nextReasoningEffort,
      }));
      writeConfigValue({
        keyPath: "model_reasoning_effort",
        value: nextReasoningEffort,
        mergeStrategy: "replace",
      });
    },
    [admin.configJson, composerConfigSnapshot.model, writeConfigValue],
  );

  const composerModelOptions = admin.availableModels.map((model) => ({
    value: model.model,
    label: model.displayName,
  }));

  const submitComposer = useCallback((): void => {
    const action = resolveChatComposerAction({
      composerText,
      hasActiveTurn,
    });

    if (action.type === "interrupt_turn") {
      interruptTurn();
      return;
    }

    if (action.type === "steer_turn") {
      steerTurn(action.prompt);
    } else {
      startTurn(action.prompt);
    }

    if (action.shouldClearComposer) {
      setComposerText("");
    }
  }, [composerText, hasActiveTurn, interruptTurn, startTurn, steerTurn]);

  return {
    workbench: {
      connectionReadiness,
      stoppedSessionState,
      hasTopAlert,
      ptyState,
      sandboxFailureMessage,
      sandboxStatusQuery,
      sessionHeaderStatusUi,
      startErrorMessage: resolvedStartErrorMessage,
      terminalPanelState,
      moreActionsState: {
        agentConnectionState: lifecycle.agentConnectionState,
        configJson: admin.configJson,
        configRequirementsJson: admin.configRequirementsJson,
        connectedSession: lifecycle.connectedSession,
        isReadingConfig: admin.isReadingConfig,
        isReadingConfigRequirements: admin.isReadingConfigRequirements,
        loadConfigSetup,
      },
    },
    conversationPane: {
      chatState: chat.chatState,
      composerProps: {
        canInterruptTurn: chat.canInterruptTurn,
        canSteerTurn: chat.canSteerTurn,
        completedErrorMessage: chat.chatState.completedErrorMessage,
        composerText,
        isConnected: lifecycle.connectedSession !== null,
        isInterruptingTurn: chat.isInterruptingTurn,
        isStartingTurn: chat.isStartingTurn,
        isSteeringTurn: chat.isSteeringTurn,
        isUpdatingComposerConfig:
          admin.isBatchWritingConfig ||
          admin.isLoadingModels ||
          admin.isReadingConfig ||
          admin.isWritingConfigValue,
        modelOptions: composerModelOptions,
        onComposerTextChange: setComposerText,
        onModelChange: setComposerModel,
        onReasoningEffortChange: setComposerReasoningEffort,
        onSubmit: submitComposer,
        selectedModel: activeComposerConfig.model,
        selectedReasoningEffort: activeComposerConfig.modelReasoningEffort,
      },
      serverRequestsState: {
        isRespondingToServerRequest: serverRequests.isRespondingToServerRequest,
        pendingServerRequests: serverRequests.pendingServerRequests,
        respondToServerRequest: serverRequests.respondToServerRequest,
      },
    },
  };
}
