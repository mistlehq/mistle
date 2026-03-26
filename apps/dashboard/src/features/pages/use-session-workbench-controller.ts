import type {
  CodexModelSummary,
  CodexTurnInputLocalImageItem,
} from "@mistle/integrations-definitions/openai/agent/client";
import {
  FileUploadRejectedError,
  FileUploadResetCodes,
  uploadSandboxImage,
} from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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

const NonImageCapableModelWarningMessageSuffix =
  " is not image-capable. Images can remain attached, but the model will not inspect them.";
const UnavailableModelErrorMessageSuffix =
  " is no longer available. Switch to another model to continue.";
const ModelSelectionRequiredMessage = "Choose a model before sending a message.";
const ModelSelectionLoadingMessage =
  "Wait for the selected model to finish loading before sending a message.";

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

function resolveUploadErrorMessage(error: unknown): string {
  if (error instanceof FileUploadRejectedError) {
    if (error.code === FileUploadResetCodes.INVALID_FILE_TYPE) {
      return "That file is not a supported PNG, JPEG, WebP, or GIF image.";
    }

    if (error.code === FileUploadResetCodes.MIME_TYPE_MISMATCH) {
      return "That file's contents do not match its declared image type.";
    }

    if (error.code === FileUploadResetCodes.INVALID_IMAGE_CONTENT) {
      return "That image file could not be validated.";
    }
  }

  return error instanceof Error ? error.message : "Could not upload attached image.";
}

export function resolveActiveComposerModel(input: {
  availableModels: readonly CodexModelSummary[];
  selectedModel: string | null;
}): CodexModelSummary | null {
  if (input.selectedModel !== null) {
    return input.availableModels.find((model) => model.model === input.selectedModel) ?? null;
  }

  return input.availableModels.find((model) => model.isDefault) ?? null;
}

export function supportsImageInspection(model: CodexModelSummary | null): boolean {
  return model?.inputModalities.includes("image") ?? false;
}

export function buildUnavailableModelErrorMessage(modelName: string): string {
  return `Model ${modelName}${UnavailableModelErrorMessageSuffix}`;
}

export function buildNonImageCapableModelWarningMessage(modelName: string): string {
  return `Model ${modelName}${NonImageCapableModelWarningMessageSuffix}`;
}

export function buildModelSelectionRequiredMessage(): string {
  return ModelSelectionRequiredMessage;
}

export function buildModelSelectionLoadingMessage(): string {
  return ModelSelectionLoadingMessage;
}

type ResolvedComposerModelContext = {
  model: CodexModelSummary;
  selectionKey: string;
};

function getComposerSelectionKey(selectedModel: string | null): string {
  return selectedModel ?? "__default__";
}

export type ComposerSubmitReadiness =
  | {
      status: "ready";
      activeModel: CodexModelSummary;
    }
  | {
      status: "missing-model";
      message: string;
    }
  | {
      status: "loading-model";
      selectedModel: string;
      message: string;
    }
  | {
      status: "unavailable-model";
      selectedModel: string;
      message: string;
    };

export type ComposerStatusMessage = {
  message: string;
  tone: "error" | "warning";
};

export function buildAttachedImagePathsText(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }

  return `Attached images:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

export function buildPromptWithAttachedImagePaths(input: {
  prompt: string;
  attachmentPaths: readonly string[];
}): string {
  const trimmedPrompt = input.prompt.trim();
  const attachedImagePathsText = buildAttachedImagePathsText(input.attachmentPaths);

  if (attachedImagePathsText.length === 0) {
    return trimmedPrompt;
  }

  if (trimmedPrompt.length === 0) {
    return attachedImagePathsText;
  }

  return `${trimmedPrompt}\n\n${attachedImagePathsText}`;
}

export function buildTurnPrompt(input: {
  prompt: string;
  attachmentPaths: readonly string[];
  supportsImageInspection: boolean;
}): string {
  if (input.supportsImageInspection) {
    return input.prompt.trim();
  }

  return buildPromptWithAttachedImagePaths({
    prompt: input.prompt,
    attachmentPaths: input.attachmentPaths,
  });
}

export function resolveTurnRepresentation(input: {
  prompt: string;
  attachmentPaths: readonly string[];
  uploadedAttachments: readonly CodexTurnInputLocalImageItem[];
  supportsImageInspection: boolean;
}): {
  prompt: string;
  submittedAttachments: readonly CodexTurnInputLocalImageItem[];
  transcriptAttachments: readonly CodexTurnInputLocalImageItem[];
} {
  return {
    prompt: buildTurnPrompt({
      prompt: input.prompt,
      attachmentPaths: input.attachmentPaths,
      supportsImageInspection: input.supportsImageInspection,
    }),
    submittedAttachments: input.supportsImageInspection ? input.uploadedAttachments : [],
    transcriptAttachments: input.uploadedAttachments,
  };
}

export function resolveComposerSubmitReadiness(input: {
  resolvedModel: CodexModelSummary | null;
  isModelListLoaded: boolean;
  selectedModel: string | null;
  activeModel: CodexModelSummary | null;
}): ComposerSubmitReadiness {
  if (input.resolvedModel !== null) {
    return {
      status: "ready",
      activeModel: input.resolvedModel,
    };
  }

  if (input.activeModel !== null) {
    return {
      status: "ready",
      activeModel: input.activeModel,
    };
  }

  if (!input.isModelListLoaded) {
    return {
      status: "loading-model",
      selectedModel: input.selectedModel ?? "__default__",
      message: buildModelSelectionLoadingMessage(),
    };
  }

  if (input.selectedModel === null) {
    return {
      status: "missing-model",
      message: buildModelSelectionRequiredMessage(),
    };
  }

  return {
    status: "unavailable-model",
    selectedModel: input.selectedModel,
    message: buildUnavailableModelErrorMessage(input.selectedModel),
  };
}

export function resolveComposerStatusMessage(input: {
  composerErrorMessage: string | null;
  hasPendingAttachments: boolean;
  submitReadiness: ComposerSubmitReadiness;
}): ComposerStatusMessage | null {
  if (input.composerErrorMessage !== null) {
    return {
      message: input.composerErrorMessage,
      tone: "error",
    };
  }

  if (input.submitReadiness.status !== "ready") {
    return {
      message: input.submitReadiness.message,
      tone: "error",
    };
  }

  if (input.hasPendingAttachments && !supportsImageInspection(input.submitReadiness.activeModel)) {
    return {
      message: buildNonImageCapableModelWarningMessage(
        input.submitReadiness.activeModel.displayName,
      ),
      tone: "warning",
    };
  }

  return null;
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
  shouldAutoResumeOnEntry: boolean;
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
    composerText: string;
    composerUi: {
      action: {
        canInterruptTurn: boolean;
        canSteerTurn: boolean;
        canSubmitTurns: boolean;
        isInterruptingTurn: boolean;
        isStartingTurn: boolean;
        isSteeringTurn: boolean;
      };
      completedErrorMessage: string | null;
      isConnected: boolean;
      isUpdatingConfig: boolean;
      isUploadingAttachments: boolean;
      statusMessage: ComposerStatusMessage | null;
    };
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
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
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
  const [resolvedComposerModelContext, setResolvedComposerModelContext] =
    useState<ResolvedComposerModelContext | null>(null);
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
    // Mirror the policy contract: stopped-state messaging stays separate from
    // connection readiness until the control-plane API exposes a dedicated
    // resume sandbox endpoint and the dashboard adopts that endpoint as the
    // supported resume flow.
    message: stoppedSessionMessage,
    requiresManualResume: stoppedSessionMessage !== null,
  };

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
    setComposerErrorMessage(null);
    setPendingComposerAttachments([]);
    setIsUploadingAttachments(false);
    setResolvedComposerModelContext(null);
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

    const timeoutId = window.setTimeout(() => {
      setAutomationPendingErrorMessage(AutomationSessionPreparationTimeoutMessage);
    }, timeoutDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [automationPendingSinceMs, isWaitingForAutomationThread]);

  const resolvedStartErrorMessage = startErrorMessage ?? automationPendingErrorMessage;

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
      setComposerErrorMessage(null);
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
      setComposerErrorMessage(null);
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

  const handleComposerTextChange = useCallback((nextText: string): void => {
    setComposerErrorMessage(null);
    setComposerText(nextText);
  }, []);

  const composerModelOptions = admin.availableModels.map((model) => ({
    value: model.model,
    label: model.displayName,
  }));
  const composerSelectionKey = getComposerSelectionKey(activeComposerConfig.model);
  const activeComposerModel = resolveActiveComposerModel({
    availableModels: admin.availableModels,
    selectedModel: activeComposerConfig.model,
  });
  const isComposerModelListLoaded = admin.hasLoadedModels;

  useEffect(() => {
    if (connectedSession === null) {
      setResolvedComposerModelContext(null);
      return;
    }

    setResolvedComposerModelContext((currentContext) => {
      if (currentContext !== null && currentContext.selectionKey !== composerSelectionKey) {
        return null;
      }

      if (activeComposerModel === null) {
        return currentContext;
      }

      if (
        currentContext !== null &&
        currentContext.selectionKey === composerSelectionKey &&
        currentContext.model.model === activeComposerModel.model &&
        currentContext.model.displayName === activeComposerModel.displayName
      ) {
        return currentContext;
      }

      return {
        selectionKey: composerSelectionKey,
        model: activeComposerModel,
      };
    });
  }, [activeComposerModel, composerSelectionKey, connectedSession]);

  const composerSubmitReadiness = resolveComposerSubmitReadiness({
    selectedModel: activeComposerConfig.model,
    activeModel: activeComposerModel,
    resolvedModel: resolvedComposerModelContext?.model ?? null,
    isModelListLoaded: isComposerModelListLoaded,
  });
  const composerStatusMessage = resolveComposerStatusMessage({
    composerErrorMessage,
    hasPendingAttachments: pendingComposerAttachments.length > 0,
    submitReadiness: composerSubmitReadiness,
  });

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

    setComposerErrorMessage(null);
    setPendingComposerAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ]);
  }, []);

  const removePendingComposerAttachment = useCallback((attachmentId: string): void => {
    setComposerErrorMessage(null);
    setPendingComposerAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    );
  }, []);

  const submitComposer = useCallback((): void => {
    void (async () => {
      setComposerErrorMessage(null);
      const action = resolveChatComposerAction({
        composerText,
        hasActiveTurn,
        hasPendingAttachments: pendingComposerAttachments.length > 0,
      });

      if (action.type === "interrupt_turn") {
        interruptTurn();
        return;
      }

      if (composerSubmitReadiness.status !== "ready") {
        setComposerErrorMessage(composerSubmitReadiness.message);
        return;
      }

      let uploadedAttachments: readonly CodexTurnInputLocalImageItem[] = [];
      let uploadedAttachmentPaths: readonly string[] = [];
      if (pendingComposerAttachments.length > 0) {
        if (
          input.sandboxInstanceId === null ||
          connectedSession === null ||
          connectedSession.threadId === null
        ) {
          setComposerErrorMessage("Connect to a sandbox session before uploading images.");
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
          uploadedAttachmentPaths = uploadedImages.map((image) => image.path);
          uploadedAttachments = uploadedImages.map((image) => ({
            type: "localImage",
            path: image.path,
          }));
        } catch (error) {
          setComposerErrorMessage(resolveUploadErrorMessage(error));
          return;
        } finally {
          setIsUploadingAttachments(false);
        }
      }

      const turnRepresentation = resolveTurnRepresentation({
        prompt: action.prompt,
        attachmentPaths: uploadedAttachmentPaths,
        uploadedAttachments,
        supportsImageInspection: supportsImageInspection(composerSubmitReadiness.activeModel),
      });

      try {
        if (action.type === "steer_turn") {
          await steerTurn({
            submittedPrompt: turnRepresentation.prompt,
            submittedAttachments: turnRepresentation.submittedAttachments,
            transcriptAttachments: turnRepresentation.transcriptAttachments,
            transcriptPrompt: action.prompt,
          });
        } else {
          await startTurn({
            submittedPrompt: turnRepresentation.prompt,
            submittedAttachments: turnRepresentation.submittedAttachments,
            transcriptAttachments: turnRepresentation.transcriptAttachments,
            transcriptPrompt: action.prompt,
          });
        }
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      if (action.shouldClearComposer) {
        setComposerText("");
      }
      setComposerErrorMessage(null);
      setPendingComposerAttachments([]);
    })();
  }, [
    composerText,
    connectedSession,
    input.sandboxInstanceId,
    hasActiveTurn,
    interruptTurn,
    activeComposerConfig.model,
    isComposerModelListLoaded,
    composerSubmitReadiness,
    pendingComposerAttachments,
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
      shouldAutoResumeOnEntry: shouldAttemptInitialStoppedResume,
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
        composerText,
        composerUi: {
          action: {
            canInterruptTurn: chat.canInterruptTurn,
            canSteerTurn: chat.canSteerTurn,
            canSubmitTurns: composerSubmitReadiness.status === "ready",
            isInterruptingTurn: chat.isInterruptingTurn,
            isStartingTurn: chat.isStartingTurn,
            isSteeringTurn: chat.isSteeringTurn,
          },
          completedErrorMessage: chat.chatState.completedErrorMessage,
          isConnected: lifecycle.connectedSession !== null,
          isUpdatingConfig:
            admin.isBatchWritingConfig ||
            admin.isLoadingModels ||
            admin.isReadingConfig ||
            admin.isWritingConfigValue,
          isUploadingAttachments,
          statusMessage: composerStatusMessage,
        },
        modelOptions: composerModelOptions,
        onComposerTextChange: handleComposerTextChange,
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
