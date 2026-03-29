import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/openai/agent/client";
import { uploadSandboxImage } from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { systemScheduler } from "@mistle/time";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  resolveSessionConnectionReadiness,
  shouldAutoConnectSession,
} from "../sessions/session-connect-policy.js";
import {
  getSandboxInstanceStatus,
  mintSandboxInstanceConnectionToken,
  resumeSandboxInstance,
} from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
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

type PendingComposerAttachment = {
  id: string;
  file: File;
  name: string;
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
  sessionReconnectState: {
    isRecovering: boolean;
    message: string | null;
  };
  shouldAutoResumeOnEntry: boolean;
  ptyState: ReturnType<typeof useSandboxPtyState>;
  requestStoppedSandboxResume: () => Promise<void>;
  sandboxLifecycleStatus: "resuming" | "starting" | "running" | "stopped" | "failed" | null;
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
    isUploadingAttachments: boolean;
    isUpdatingComposerConfig: boolean;
    modelOptions: Array<{
      value: string;
      label: string;
    }>;
    onComposerTextChange: (nextText: string) => void;
    onModelChange: (nextModel: string) => void;
    onPendingImageFilesAdded: (files: readonly File[]) => void;
    onReasoningEffortChange: (nextReasoningEffort: string) => void;
    onRemovePendingAttachment: (attachmentId: string) => void;
    onSubmit: () => void;
    pendingAttachments: readonly {
      id: string;
      name: string;
    }[];
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

const MaxCodexReconnectAttempts = 3;
const CodexReconnectLimitMessage = `Could not reconnect session after ${String(MaxCodexReconnectAttempts)} attempts.`;

type RecoverableCodexDisconnect = {
  id: number;
  message: string;
  preferredThreadId: string | null;
};

type CodexRecoveryReconnectCommand = "none" | "reconnect";

type CodexRecoveryObservedState = {
  canConnect: boolean;
  connected: boolean;
  hasStartError: boolean;
  isStartingSession: boolean;
  isWaitingForAutomationThread: boolean;
  sandboxInstanceId: string | null;
  sandboxStatus: "resuming" | "starting" | "running" | "stopped" | "failed" | null;
};

type CodexRecoveryState =
  | {
      kind: "idle";
    }
  | {
      kind: "recovering";
      baseMessage: string;
      errorMessage: string | null;
      preferredThreadId: string | null;
      reconnectAttemptCount: number;
      reconnectCommand: CodexRecoveryReconnectCommand;
      recoverableDisconnectId: number;
    };

type CodexRecoveryEvent =
  | {
      type: "recoverable_disconnect_observed";
      disconnect: RecoverableCodexDisconnect;
    }
  | {
      type: "reconnect_attempt_started";
    }
  | {
      type: "sandbox_changed";
    }
  | {
      type: "session_connected";
    }
  | {
      type: "sync_observed";
      observation: CodexRecoveryObservedState;
    };

function createCodexRecoveryStateFromDisconnect(
  disconnect: RecoverableCodexDisconnect,
): CodexRecoveryState {
  return {
    kind: "recovering",
    baseMessage: disconnect.message,
    errorMessage: null,
    preferredThreadId: disconnect.preferredThreadId,
    reconnectAttemptCount: 0,
    reconnectCommand: "none",
    recoverableDisconnectId: disconnect.id,
  };
}

// Keep the reconnect policy in one reducer so the controller does not have to
// coordinate multiple booleans and refs across several effects.
export function reduceCodexRecoveryState(
  state: CodexRecoveryState,
  event: CodexRecoveryEvent,
): CodexRecoveryState {
  switch (state.kind) {
    case "idle": {
      if (event.type === "recoverable_disconnect_observed") {
        return createCodexRecoveryStateFromDisconnect(event.disconnect);
      }

      return state;
    }

    case "recovering": {
      switch (event.type) {
        case "recoverable_disconnect_observed": {
          if (state.recoverableDisconnectId === event.disconnect.id) {
            return {
              ...state,
              baseMessage: event.disconnect.message,
              preferredThreadId: event.disconnect.preferredThreadId,
            };
          }

          return createCodexRecoveryStateFromDisconnect(event.disconnect);
        }

        case "reconnect_attempt_started": {
          if (state.reconnectCommand !== "reconnect") {
            return state;
          }

          return {
            ...state,
            reconnectAttemptCount: state.reconnectAttemptCount + 1,
            reconnectCommand: "none",
          };
        }

        case "sandbox_changed":
        case "session_connected": {
          return {
            kind: "idle",
          };
        }

        case "sync_observed": {
          if (event.observation.connected) {
            return {
              kind: "idle",
            };
          }

          if (state.errorMessage !== null) {
            return state.reconnectCommand === "none"
              ? state
              : {
                  ...state,
                  reconnectCommand: "none",
                };
          }

          if (event.observation.sandboxStatus === "failed") {
            return {
              ...state,
              errorMessage: `${state.baseMessage} The sandbox failed and the session cannot reconnect.`,
              reconnectCommand: "none",
            };
          }

          if (state.reconnectAttemptCount >= MaxCodexReconnectAttempts) {
            return {
              ...state,
              errorMessage: CodexReconnectLimitMessage,
              reconnectCommand: "none",
            };
          }

          if (
            event.observation.sandboxInstanceId === null ||
            !event.observation.canConnect ||
            event.observation.hasStartError ||
            event.observation.isStartingSession ||
            event.observation.isWaitingForAutomationThread ||
            event.observation.sandboxStatus !== "running"
          ) {
            return state.reconnectCommand === "none"
              ? state
              : {
                  ...state,
                  reconnectCommand: "none",
                };
          }

          return state.reconnectCommand === "reconnect"
            ? state
            : {
                ...state,
                reconnectCommand: "reconnect",
              };
        }
      }
    }
  }
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
  sandboxStatus: "pending" | "starting" | "running" | "stopped" | "failed" | null;
}): boolean {
  return (
    input.sandboxStatus === "stopped" &&
    (input.isResumingStoppedSandbox ||
      input.shouldAttemptInitialStoppedResume ||
      (input.hasAttemptedInitialStoppedResume && input.resumeActionErrorMessage === null))
  );
}

export function resolveCodexReconnectMessage(input: {
  recoveryBaseMessage: string | null;
  recoveryErrorMessage: string | null;
  reconnectAttemptCount: number;
  sandboxStatus: "resuming" | "starting" | "running" | "stopped" | "failed" | null;
}): string | null {
  if (input.recoveryErrorMessage !== null) {
    return input.recoveryErrorMessage;
  }

  if (input.recoveryBaseMessage === null) {
    return null;
  }

  if (input.sandboxStatus === "stopped") {
    return `${input.recoveryBaseMessage} Resuming sandbox to restore the session.`;
  }

  if (
    input.sandboxStatus === "resuming" ||
    input.sandboxStatus === "starting" ||
    input.sandboxStatus === null
  ) {
    return `${input.recoveryBaseMessage} Waiting for the sandbox to become ready again.`;
  }

  if (input.sandboxStatus === "failed") {
    return `${input.recoveryBaseMessage} The sandbox failed and the session cannot reconnect.`;
  }

  return `${input.recoveryBaseMessage} Reconnecting session${input.reconnectAttemptCount > 0 ? ` (attempt ${String(input.reconnectAttemptCount)} of ${String(MaxCodexReconnectAttempts)})` : ""}.`;
}

export function shouldPollStoppedSandboxStatus(input: {
  sandboxStatus: "pending" | "starting" | "running" | "stopped" | "failed" | null;
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
  sandboxStatus: "pending" | "starting" | "running" | "stopped" | "failed" | null;
}): SessionEntryPhase {
  if (input.sandboxStatus === "failed") {
    return "sandbox_failed";
  }

  if (input.sandboxStatus === "running") {
    return input.connectedSession ? "ready" : "connecting";
  }

  if (input.sandboxStatus === "pending" || input.sandboxStatus === "starting") {
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
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  const [automationPendingSinceMs, setAutomationPendingSinceMs] = useState<number | null>(null);
  const [automationPendingErrorMessage, setAutomationPendingErrorMessage] = useState<string | null>(
    null,
  );
  const [hasAttemptedInitialStoppedResume, setHasAttemptedInitialStoppedResume] = useState(false);
  const [isResumingStoppedSandbox, setIsResumingStoppedSandbox] = useState(false);
  const [resumeActionErrorMessage, setResumeActionErrorMessage] = useState<string | null>(null);
  const [composerConfigDraft, setComposerConfigDraft] = useState<ComposerConfigDraft | null>(null);
  const [codexRecoveryState, dispatchCodexRecoveryEvent] = useReducer(reduceCodexRecoveryState, {
    kind: "idle",
  });
  const activeResumeRequestRef = useRef<ResumeRequestGuard | null>(null);
  const resumeIdempotencyKeyRef = useRef<string | null>(null);
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
    recoverableDisconnect,
    reportStartErrorMessage,
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
  const shouldAttemptRecoverableStoppedResume =
    input.sandboxInstanceId !== null &&
    sandboxStatus === "stopped" &&
    recoverableDisconnect !== null;
  const shouldAttemptInitialStoppedResume =
    input.sandboxInstanceId !== null &&
    sandboxStatus === "stopped" &&
    recoverableDisconnect === null &&
    !hasAttemptedInitialStoppedResume;
  const isShowingResumeInFlightState = shouldShowResumeInFlightState({
    hasAttemptedInitialStoppedResume,
    resumeActionErrorMessage,
    shouldAttemptInitialStoppedResume:
      shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume,
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
  const shouldAutoResumeOnEntry =
    shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume;

  useEffect(() => {
    if (recoverableDisconnect === null) {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "recoverable_disconnect_observed",
      disconnect: recoverableDisconnect,
    });
  }, [recoverableDisconnect]);

  useEffect(() => {
    if (connectedSession === null) {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "session_connected",
    });
  }, [connectedSession]);

  // Syncs teardown with the external Codex session and PTY lifecycles on unmount.
  useEffect(() => {
    return () => {
      clearStartErrorMessage();
      disconnectSession();
      void disconnectPty();
    };
  }, [clearStartErrorMessage, disconnectPty, disconnectSession]);

  useEffect(() => {
    setComposerText("");
    setPendingComposerAttachments([]);
    setIsUploadingAttachments(false);
    dispatchCodexRecoveryEvent({
      type: "sandbox_changed",
    });
  }, [input.sandboxInstanceId]);

  // Syncs a browser timer with the external automation-thread preparation window.
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

  const resolvedStartErrorMessage = startErrorMessage ?? automationPendingErrorMessage;
  const codexRecoveryBaseMessage =
    codexRecoveryState.kind === "recovering" ? codexRecoveryState.baseMessage : null;
  const codexRecoveryErrorMessage =
    codexRecoveryState.kind === "recovering" ? codexRecoveryState.errorMessage : null;
  const codexReconnectAttemptCount =
    codexRecoveryState.kind === "recovering" ? codexRecoveryState.reconnectAttemptCount : 0;

  useEffect(() => {
    dispatchCodexRecoveryEvent({
      type: "sync_observed",
      observation: {
        canConnect: connectionReadiness.canConnect,
        connected: connectedSession !== null,
        hasStartError: resolvedStartErrorMessage !== null,
        isStartingSession,
        isWaitingForAutomationThread,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: effectiveSandboxStatus,
      },
    });
  }, [
    connectedSession,
    connectionReadiness.canConnect,
    effectiveSandboxStatus,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    resolvedStartErrorMessage,
  ]);

  // Syncs React with the external Codex session connection lifecycle.
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

    if (recoverableDisconnect !== null || codexRecoveryState.kind !== "idle") {
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
    codexRecoveryState.kind,
    recoverableDisconnect,
    hasAttemptedAutoConnect,
    input.sandboxInstanceId,
    isStartingSession,
    isWaitingForAutomationThread,
    connectionReadiness.canConnect,
    resolvedStartErrorMessage,
  ]);

  useEffect(() => {
    if (
      input.sandboxInstanceId === null ||
      codexRecoveryState.kind !== "recovering" ||
      codexRecoveryState.reconnectCommand !== "reconnect"
    ) {
      return;
    }

    dispatchCodexRecoveryEvent({
      type: "reconnect_attempt_started",
    });
    connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      preferredThreadId:
        codexRecoveryState.preferredThreadId ??
        automationConversation?.providerConversationId ??
        null,
      recoverableDisconnectId: codexRecoveryState.recoverableDisconnectId,
    });
  }, [automationConversation, codexRecoveryState, connectSession, input.sandboxInstanceId]);

  // Syncs a status refetch with the external sandbox startup lifecycle.
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

  const sessionReconnectMessage = resolveCodexReconnectMessage({
    recoveryBaseMessage: codexRecoveryBaseMessage,
    recoveryErrorMessage: codexRecoveryErrorMessage,
    reconnectAttemptCount: codexReconnectAttemptCount,
    sandboxStatus: effectiveSandboxStatus,
  });
  const isRecoveringCodexSession =
    sessionReconnectMessage !== null &&
    codexRecoveryErrorMessage === null &&
    effectiveSandboxStatus !== "failed" &&
    connectedSession === null;
  const sessionHeaderStatusUi = resolveSessionHeaderStatusUi({
    sandboxStatus: sandboxStatusLabel.toLowerCase(),
    agentConnectionState,
    step,
    hasConnectionError: resolvedStartErrorMessage !== null,
    isRecoveringSession: isRecoveringCodexSession,
  });

  const hasActiveTurn = canInterruptTurn || canSteerTurn;
  const sandboxFailureMessage = sandboxStatusQuery.data?.failureMessage ?? null;
  const hasTopAlert = hasSessionTopAlert({
    hasSandboxStatusError: sandboxStatusQuery.isError,
    reconnectMessage: sessionReconnectMessage,
    startErrorMessage: resolvedStartErrorMessage,
    sandboxFailureMessage,
    stoppedSessionMessage: stoppedSessionState.message,
  });
  // Syncs the connected admin channel with external model/config state.
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

  const addPendingComposerFiles = useCallback((files: readonly File[]): void => {
    const nextAttachments = files.flatMap((file) => {
      if (!file.type.startsWith("image/")) {
        return [];
      }

      return [
        {
          id: crypto.randomUUID(),
          file,
          name: file.name,
        },
      ];
    });

    if (nextAttachments.length === 0) {
      return;
    }

    setPendingComposerAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ]);
  }, []);

  const removePendingComposerAttachment = useCallback((attachmentId: string): void => {
    setPendingComposerAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    );
  }, []);

  const submitComposer = useCallback((): void => {
    void (async () => {
      const action = resolveChatComposerAction({
        composerText,
        hasActiveTurn,
        hasPendingAttachments: pendingComposerAttachments.length > 0,
      });

      if (action.type === "interrupt_turn") {
        interruptTurn();
        return;
      }

      let uploadedAttachments: readonly CodexTurnInputLocalImageItem[] = [];
      if (pendingComposerAttachments.length > 0) {
        if (
          input.sandboxInstanceId === null ||
          connectedSession === null ||
          connectedSession.threadId === null
        ) {
          reportStartErrorMessage("Connect to a sandbox session before uploading images.");
          return;
        }

        setIsUploadingAttachments(true);
        try {
          const runtime = createBrowserSandboxSessionRuntime();
          const uploadedImages = [];
          for (const attachment of pendingComposerAttachments) {
            const mintedConnection = await mintSandboxInstanceConnectionToken({
              instanceId: input.sandboxInstanceId,
            });
            uploadedImages.push(
              await uploadSandboxImage({
                connectionUrl: mintedConnection.connectionUrl,
                file: attachment.file,
                runtime,
                threadId: connectedSession.threadId,
              }),
            );
          }
          uploadedAttachments = uploadedImages.map((image) => ({
            type: "localImage",
            path: image.path,
          }));
        } catch (error) {
          reportStartErrorMessage(
            error instanceof Error ? error.message : "Could not upload attached image.",
          );
          return;
        } finally {
          setIsUploadingAttachments(false);
        }
      }

      try {
        if (action.type === "steer_turn") {
          await steerTurn({
            prompt: action.prompt,
            attachments: uploadedAttachments,
          });
        } else {
          await startTurn({
            prompt: action.prompt,
            attachments: uploadedAttachments,
          });
        }
      } catch (error) {
        reportStartErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      if (action.shouldClearComposer) {
        setComposerText("");
      }
      setPendingComposerAttachments([]);
    })();
  }, [
    composerText,
    connectedSession,
    input.sandboxInstanceId,
    hasActiveTurn,
    interruptTurn,
    pendingComposerAttachments,
    reportStartErrorMessage,
    startTurn,
    steerTurn,
  ]);

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
      if (resumedSandboxStatus.status !== "stopped") {
        resumeIdempotencyKeyRef.current = null;
      }
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
    clearStartErrorMessage,
    input.sandboxInstanceId,
    isResumingStoppedSandbox,
    queryClient,
    sandboxStatus,
    sandboxStatusQuery.refetch,
  ]);

  return {
    workbench: {
      connectionReadiness,
      stoppedSessionState,
      hasTopAlert,
      isResumingStoppedSandbox: isShowingResumeInFlightState,
      sessionReconnectState: {
        isRecovering: isRecoveringCodexSession,
        message: sessionReconnectMessage,
      },
      shouldAutoResumeOnEntry,
      ptyState,
      requestStoppedSandboxResume,
      sandboxLifecycleStatus: effectiveSandboxStatus,
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
        isUploadingAttachments,
        isUpdatingComposerConfig:
          admin.isBatchWritingConfig ||
          admin.isLoadingModels ||
          admin.isReadingConfig ||
          admin.isWritingConfigValue,
        modelOptions: composerModelOptions,
        onComposerTextChange: setComposerText,
        onModelChange: setComposerModel,
        onPendingImageFilesAdded: addPendingComposerFiles,
        onReasoningEffortChange: setComposerReasoningEffort,
        onRemovePendingAttachment: removePendingComposerAttachment,
        onSubmit: submitComposer,
        pendingAttachments: pendingComposerAttachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
        })),
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
