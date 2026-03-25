import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  getBestEffortBrowserStorage,
  isExpiringBrowserStorageRecord,
  readBrowserStorageJson,
  removeBrowserStorageItem,
  writeBrowserStorageJson,
} from "../shared/browser-storage.js";
import {
  hasSessionTopAlert,
  resolveChatComposerAction,
  resolveSessionHeaderStatusUi,
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
const ResumeIdempotencyKeyStorageKeyPrefix = "dashboard:session-workbench:resume-idempotency:";
const ResumeIdempotencyKeyTtlMs = 5 * 60 * 1_000;

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

type SessionWorkbenchState = {
  connectionReadiness: {
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
  stoppedSessionState: {
    message: string | null;
    requiresManualResume: boolean;
  };
  hasTopAlert: boolean;
  isResumingStoppedSandbox: boolean;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  requestStoppedSandboxResume: () => Promise<void>;
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

type ResumeIdempotencyStorageRecord = {
  value: string;
  expiresAtMs: number;
};

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

export function getSandboxInstanceStatusQueryKey(
  sandboxInstanceId: string | null,
): readonly ["sandbox-instance-status", string | null] {
  return ["sandbox-instance-status", sandboxInstanceId];
}

export function createResumeIdempotencyStorageKey(sandboxInstanceId: string): string {
  return `${ResumeIdempotencyKeyStorageKeyPrefix}${sandboxInstanceId}`;
}

function isResumeIdempotencyStorageRecord(value: unknown): value is ResumeIdempotencyStorageRecord {
  return isExpiringBrowserStorageRecord(value, (storedValue): storedValue is string => {
    return typeof storedValue === "string" && storedValue.length > 0;
  });
}

function createResumeIdempotencyStorageRecord(input: {
  idempotencyKey: string;
  nowMs: number;
}): ResumeIdempotencyStorageRecord {
  return {
    value: input.idempotencyKey,
    expiresAtMs: input.nowMs + ResumeIdempotencyKeyTtlMs,
  };
}

export function readStoredResumeIdempotencyRecord(input: {
  sandboxInstanceId: string;
  storage: Pick<Storage, "getItem" | "removeItem"> | null;
  nowMs: number;
}): ResumeIdempotencyStorageRecord | null {
  const storageKey = createResumeIdempotencyStorageKey(input.sandboxInstanceId);
  const storedRecord = readBrowserStorageJson({
    key: storageKey,
    storage: input.storage,
    isValue: isResumeIdempotencyStorageRecord,
  });
  if (storedRecord === null) {
    return null;
  }

  if (storedRecord.expiresAtMs <= input.nowMs) {
    removeBrowserStorageItem({
      key: storageKey,
      storage: input.storage,
    });
    return null;
  }

  return storedRecord;
}

export function readStoredResumeIdempotencyKey(input: {
  sandboxInstanceId: string;
  storage: Pick<Storage, "getItem" | "removeItem"> | null;
  nowMs: number;
}): string | null {
  return (
    readStoredResumeIdempotencyRecord({
      sandboxInstanceId: input.sandboxInstanceId,
      storage: input.storage,
      nowMs: input.nowMs,
    })?.value ?? null
  );
}

export function persistResumeIdempotencyKey(input: {
  sandboxInstanceId: string;
  idempotencyKey: string;
  storage: Pick<Storage, "setItem"> | null;
  nowMs: number;
}): boolean {
  return writeBrowserStorageJson({
    key: createResumeIdempotencyStorageKey(input.sandboxInstanceId),
    value: createResumeIdempotencyStorageRecord({
      idempotencyKey: input.idempotencyKey,
      nowMs: input.nowMs,
    }),
    storage: input.storage,
  });
}

export function clearStoredResumeIdempotencyKey(input: {
  sandboxInstanceId: string;
  storage: Pick<Storage, "removeItem"> | null;
}): boolean {
  return removeBrowserStorageItem({
    key: createResumeIdempotencyStorageKey(input.sandboxInstanceId),
    storage: input.storage,
  });
}

export function shouldClearStoredResumeIdempotencyKey(
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null,
): boolean {
  return sandboxStatus === "running" || sandboxStatus === "failed";
}

export function shouldShowResumeInFlightState(input: {
  shouldAttemptInitialStoppedResume: boolean;
  isResumingStoppedSandbox: boolean;
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
}): boolean {
  return (
    input.sandboxStatus === "stopped" &&
    (input.isResumingStoppedSandbox || input.shouldAttemptInitialStoppedResume)
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

  return input.isStatusPending ? "loading" : "loading";
}

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

function resolveResumeFailureMessage(error: unknown): string {
  if (error instanceof SandboxProfilesApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Could not resume sandbox session.";
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

export function useSessionWorkbenchController(input: {
  sandboxInstanceId: string | null;
}): UseSessionWorkbenchControllerResult {
  const [composerText, setComposerText] = useState("");
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const [hasAttemptedInitialStoppedResume, setHasAttemptedInitialStoppedResume] = useState(false);
  const [isResumingStoppedSandbox, setIsResumingStoppedSandbox] = useState(false);
  const [resumeActionErrorMessage, setResumeActionErrorMessage] = useState<string | null>(null);
  const [composerConfigDraft, setComposerConfigDraft] = useState<ComposerConfigDraft | null>(null);
  const activeResumeRequestRef = useRef<ResumeRequestGuard | null>(null);
  const nextResumeRequestIdRef = useRef(0);
  const initialSandboxStatusDataUpdatedAtRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
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
  const { batchWriteConfig, loadModels, readConfig, writeConfigValue } = admin;
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

      return status === "running" || status === "failed" || status === "stopped" ? false : 1_000;
    },
  });
  if (initialSandboxStatusDataUpdatedAtRef.current === null) {
    initialSandboxStatusDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
  }
  const sandboxStatus = sandboxStatusQuery.data?.status ?? null;
  const shouldAttemptInitialStoppedResume =
    input.sandboxInstanceId !== null &&
    sandboxStatus === "stopped" &&
    !hasAttemptedInitialStoppedResume;
  const isShowingResumeInFlightState = shouldShowResumeInFlightState({
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
    setHasAttemptedInitialStoppedResume(false);
    setIsResumingStoppedSandbox(false);
    setResumeActionErrorMessage(null);
    activeResumeRequestRef.current = null;
    initialSandboxStatusDataUpdatedAtRef.current = sandboxStatusQuery.dataUpdatedAt;
    clearStartErrorMessage();
    disconnectSession();
    void disconnectPty();
  }, [clearStartErrorMessage, disconnectPty, disconnectSession, input.sandboxInstanceId]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || !shouldClearStoredResumeIdempotencyKey(sandboxStatus)) {
      return;
    }

    clearStoredResumeIdempotencyKey({
      sandboxInstanceId: input.sandboxInstanceId,
      storage: getBestEffortBrowserStorage("local"),
    });
    setResumeActionErrorMessage(null);
  }, [input.sandboxInstanceId, sandboxStatus]);

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
    // This reconnect path only supports initial bootstrap for the latest
    // persisted automation binding. Live migration of an already-open session
    // across route rebinding is currently unsupported.
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
    effectiveSandboxStatus ?? (sandboxStatusQuery.isPending ? "Loading" : "Unknown");
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

  const requestStoppedSandboxResume = useCallback(async (): Promise<void> => {
    if (
      input.sandboxInstanceId === null ||
      sandboxStatus !== "stopped" ||
      isResumingStoppedSandbox
    ) {
      return;
    }

    const nowMs = Date.now();
    const storage = getBestEffortBrowserStorage("local");
    const storedResumeRecord =
      readStoredResumeIdempotencyRecord({
        sandboxInstanceId: input.sandboxInstanceId,
        storage,
        nowMs,
      }) ??
      createResumeIdempotencyStorageRecord({
        idempotencyKey: crypto.randomUUID(),
        nowMs,
      });
    const idempotencyKey = storedResumeRecord.value;
    const requestId = nextResumeRequestIdRef.current + 1;
    nextResumeRequestIdRef.current = requestId;
    activeResumeRequestRef.current = {
      requestId,
      sandboxInstanceId: input.sandboxInstanceId,
    };

    persistResumeIdempotencyKey({
      sandboxInstanceId: input.sandboxInstanceId,
      idempotencyKey,
      storage,
      nowMs,
    });
    setResumeActionErrorMessage(null);

    clearStartErrorMessage();
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
        queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: resumedSandboxStatus,
      });
      clearStartErrorMessage();
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
        clearStoredResumeIdempotencyKey({
          sandboxInstanceId: input.sandboxInstanceId,
          storage,
        });
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
    input.sandboxInstanceId,
    isResumingStoppedSandbox,
    queryClient,
    sandboxStatus,
    sandboxStatusQuery.refetch,
  ]);

  useEffect(() => {
    if (
      input.sandboxInstanceId === null ||
      isResumingStoppedSandbox ||
      sandboxStatus !== "stopped" ||
      hasAttemptedInitialStoppedResume
    ) {
      return;
    }

    setHasAttemptedInitialStoppedResume(true);
    void requestStoppedSandboxResume();
  }, [
    hasAttemptedInitialStoppedResume,
    input.sandboxInstanceId,
    isResumingStoppedSandbox,
    requestStoppedSandboxResume,
    sandboxStatus,
  ]);

  return {
    workbench: {
      connectionReadiness,
      stoppedSessionState,
      hasTopAlert,
      isResumingStoppedSandbox: isShowingResumeInFlightState,
      ptyState,
      requestStoppedSandboxResume,
      sandboxFailureMessage,
      sandboxStatusQuery,
      sessionHeaderStatusUi,
      startErrorMessage: resolvedStartErrorMessage,
      terminalPanelState,
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
