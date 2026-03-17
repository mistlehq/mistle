import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCodexSessionState } from "../codex-client/use-codex-session-state.js";
import { shouldAutoConnectSession } from "../sessions/session-connect-policy.js";
import { getSandboxInstanceStatus } from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  hasSessionTopAlert,
  resolveChatComposerAction,
  resolveSessionHeaderStatusUi,
} from "./codex-session-page-view-model.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";

type ComposerConfigSnapshot = {
  model: string | null;
  modelReasoningEffort: string | null;
};

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

type CodexSessionWorkbenchState = {
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

type CodexSessionPaneState = {
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

type UseCodexSessionPageControllerResult = {
  workbench: CodexSessionWorkbenchState;
  codexPane: CodexSessionPaneState;
};

export type {
  CodexSessionPaneState,
  CodexSessionWorkbenchState,
  UseCodexSessionPageControllerResult,
};

export function useCodexSessionPageController(input: {
  sandboxInstanceId: string | null;
}): UseCodexSessionPageControllerResult {
  const [composerText, setComposerText] = useState("");
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [selectedComposerModel, setSelectedComposerModel] = useState<string | null>(null);
  const [selectedComposerReasoningEffort, setSelectedComposerReasoningEffort] = useState<
    string | null
  >(null);
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
      const status = query.state.data?.status;
      return status === "running" || status === "failed" || status === "stopped" ? false : 1_000;
    },
  });

  useEffect(() => {
    setHasAttemptedAutoConnect(false);
    clearStartErrorMessage();
    disconnectSession();
    void disconnectPty();
  }, [clearStartErrorMessage, disconnectPty, disconnectSession, input.sandboxInstanceId]);

  useEffect(() => {
    if (input.sandboxInstanceId === null) {
      return;
    }

    if (
      !shouldAutoConnectSession({
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: sandboxStatusQuery.data?.status ?? null,
        connected: connectedSession !== null,
        isStartingSession,
        hasAttemptedAutoConnect,
        hasStartError: startErrorMessage !== null,
      })
    ) {
      return;
    }

    setHasAttemptedAutoConnect(true);
    connectSession({ sandboxInstanceId: input.sandboxInstanceId });
  }, [
    connectSession,
    connectedSession,
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    sandboxStatusQuery.data?.status,
    startErrorMessage,
  ]);

  const sessionHeaderStatusUi = useMemo(() => {
    const sandboxStatusLabel =
      sandboxStatusQuery.data?.status ?? (sandboxStatusQuery.isPending ? "Loading" : "Unknown");

    return resolveSessionHeaderStatusUi({
      sandboxStatus: sandboxStatusLabel.toLowerCase(),
      agentConnectionState,
      step,
      hasConnectionError: startErrorMessage !== null,
    });
  }, [
    agentConnectionState,
    sandboxStatusQuery.data?.status,
    sandboxStatusQuery.isPending,
    startErrorMessage,
    step,
  ]);

  const hasActiveTurn = canInterruptTurn || canSteerTurn;
  const sandboxFailureMessage = sandboxStatusQuery.data?.failureMessage ?? null;
  const hasTopAlert = hasSessionTopAlert({
    hasSandboxStatusError: sandboxStatusQuery.isError,
    startErrorMessage,
    sandboxFailureMessage,
  });
  const loadConfigSetup = useCallback((): void => {
    readConfig(true);
    readConfigRequirements();
  }, [readConfig, readConfigRequirements]);

  useEffect(() => {
    if (connectedSession === null) {
      setSelectedComposerModel(null);
      setSelectedComposerReasoningEffort(null);
      return;
    }

    loadModels();
    readConfig(false);
  }, [connectedSession, loadModels, readConfig]);

  useEffect(() => {
    const snapshot = readComposerConfigSnapshot(admin.configJson);
    setSelectedComposerModel(snapshot.model);
    setSelectedComposerReasoningEffort(snapshot.modelReasoningEffort);
  }, [admin.configJson]);

  const setComposerModel = useCallback(
    (nextModel: string): void => {
      setSelectedComposerModel(nextModel);
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
    [batchWriteConfig],
  );

  const setComposerReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      setSelectedComposerReasoningEffort(nextReasoningEffort);
      writeConfigValue({
        keyPath: "model_reasoning_effort",
        value: nextReasoningEffort,
        mergeStrategy: "replace",
      });
    },
    [writeConfigValue],
  );

  const composerModelOptions = useMemo(() => {
    return admin.availableModels.map((model) => ({
      value: model.model,
      label: model.displayName,
    }));
  }, [admin.availableModels]);

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
      hasTopAlert,
      ptyState,
      sandboxFailureMessage,
      sandboxStatusQuery,
      sessionHeaderStatusUi,
      startErrorMessage,
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
    codexPane: {
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
        selectedModel: selectedComposerModel,
        selectedReasoningEffort: selectedComposerReasoningEffort,
      },
      serverRequestsState: {
        isRespondingToServerRequest: serverRequests.isRespondingToServerRequest,
        pendingServerRequests: serverRequests.pendingServerRequests,
        respondToServerRequest: serverRequests.respondToServerRequest,
      },
    },
  };
}
