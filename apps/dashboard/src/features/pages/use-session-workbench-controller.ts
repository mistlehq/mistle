import type {
  CodexJsonRpcClient,
  AgentStreamClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type {
  OpenCodePermissionRequest,
  OpenCodePermissionResponseInput,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ChatState } from "../chat/chat-state.js";
import { formatCodexContextUsage } from "../session-agents/codex/session-state/codex-context-usage.js";
import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
  buildOpenCodeAttachmentParts,
  parseOpenCodePromptModelSelection,
  useOpenCodeSessionState,
  type OpenCodeChatState,
} from "../session-agents/opencode/session-state/index.js";
import type {
  OpenCodePermissionApprovalRequestEntry,
  ServerRequestEntry,
} from "../session-agents/server-requests/index.js";
import { applyPatchedSessionTitleToCache } from "../sessions/session-header-title-model.js";
import { generateSessionTitleWithSandboxCodexExec } from "../sessions/session-title-generation.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import {
  patchSandboxInstanceTitle,
  type PatchSandboxInstanceTitleResult,
} from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useLocalSessionComposerConfigControl,
  usePersistedSessionComposerConfigControl,
  useSessionComposerAttachmentControl,
  type SessionComposerConfigWriter,
  type SessionComposerRuntimeInput,
  type SessionComposerSharedInput,
  type SessionComposerStateInput,
  type SessionTurnControl,
} from "./session-composer/index.js";
import type { InitialSessionConnectInput } from "./session-initial-connect-policy.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  resolveInitialSelectedRepositoryPath,
  resolvePrimaryRepositoryTurnStartCwd,
  resolveSessionTerminalCwd,
} from "./session-primary-repository-policy.js";
import { SessionRuntimeWorkbenchCapabilities } from "./session-runtime-workbench-capabilities.js";
import type { SessionStartupState } from "./session-startup-status.js";
import type {
  SessionTerminalContentInset,
  SessionTerminalThemeMode,
} from "./session-terminal-surface.js";
import {
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveSandboxStatusReadState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveWorkbenchEntryPhase,
  shouldWaitForAutomationSessionThread,
} from "./session-workbench-state.js";
import type { SessionWorkbenchStatus } from "./session-workbench-state.js";
import { useSessionBranchDiff } from "./use-session-branch-diff.js";
import { useSessionDiffWorkbenchState } from "./use-session-diff-workbench-state.js";
import {
  useSessionMainPanelHandoff,
  type SessionMainPanelHandoffLifecycle,
  type SessionMainPanelHandoffRuntime,
  type SessionMainPanelRuntimeId,
} from "./use-session-main-panel-handoff.js";
import { useSessionPortAccess } from "./use-session-port-access.js";
import { useSessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";
import { useSessionRepositoryStatus } from "./use-session-repository-status.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import { useSessionWorkbenchLifecycleState } from "./use-session-workbench-lifecycle-state.js";
import { useSessionWorkbenchTransport } from "./use-session-workbench-transport.js";

type SessionWorkbenchState = {
  terminalCwd: string;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
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
  handleTerminalWorkspaceReset: () => void;
  stoppedSessionMessage: string | null;
  workbenchStatus: SessionWorkbenchStatus;
  sandboxLifecycleStatus: ReturnType<
    typeof useSessionWorkbenchLifecycleState
  >["sandboxLifecycleStatus"];
  initialEntryStartupState: SessionStartupState | null;
  sandboxStatusQuery: ReturnType<typeof useSessionWorkbenchLifecycleState>["sandboxStatusQuery"];
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  primaryPanelState: {
    transitionState: MainPanelTransitionState;
    canEnterCli: boolean;
    disabledReason: string | null;
    error: ReturnType<typeof useSessionMainPanelHandoff>["error"];
    isCliToggleActive: boolean;
    showsChatComposer: boolean;
    cliTerminalContentInset: SessionTerminalContentInset;
    cliTerminalThemeMode: SessionTerminalThemeMode;
    cliRuntimeDisplayName: string;
    enterCliMode: () => Promise<void>;
    exitCliMode: () => Promise<void>;
  };
  terminalPanelState: {
    closePanel: () => void;
    isVisible: boolean;
    openPanel: () => void;
    togglePanel: () => void;
  };
  diffPanelState: {
    closePanel: () => void;
    compareLabel: string;
    errorNotice: ReturnType<typeof useSessionBranchDiff>["errorNotice"];
    isLoading: boolean;
    isVisible: boolean;
    openPanel: () => void;
    patch: string;
    togglePanel: () => void;
  };
  primaryRepositoryState: ReturnType<typeof useSessionPrimaryRepositoryState>;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  portAccessState: ReturnType<typeof useSessionPortAccess>;
};

export function resolveOpenCodePromptModelOverride(
  hasExplicitModelSelection: boolean,
  selectedModel: string | null,
): ReturnType<typeof parseOpenCodePromptModelSelection> | undefined {
  if (!hasExplicitModelSelection || selectedModel === null) {
    return undefined;
  }

  return parseOpenCodePromptModelSelection(selectedModel);
}

export function buildOpenCodeComposerConfigResetKey(
  sandboxInstanceId: string | null,
  sessionId: string | null,
): string {
  return `${sandboxInstanceId ?? ""}:${sessionId ?? ""}`;
}

type SessionConversationChatState = Pick<
  ChatState,
  "activeTurnId" | "entries" | "pendingTurnId" | "status"
>;

type SessionConversationPaneState = {
  activeConversationId: string | null;
  chatState: SessionConversationChatState;
  dismissUserMessageAction?: ReturnType<
    typeof useCodexSessionState
  >["chat"]["dismissUserMessageAction"];
  composerStateInput: SessionComposerStateInput;
  serverRequestsState: {
    isRespondingToServerRequest: boolean;
    pendingServerRequests: readonly ServerRequestEntry[];
    respondToServerRequest: (requestId: string | number, result: unknown) => void;
  };
};

type SessionWorkbenchRuntimeAdapter = {
  displayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  conversation: {
    activeConversationId: string | null;
    chatState: SessionConversationChatState;
    dismissUserMessageAction?: ReturnType<
      typeof useCodexSessionState
    >["chat"]["dismissUserMessageAction"];
  };
  composerRuntimeInput: SessionComposerRuntimeInput;
  serverRequestsState: SessionConversationPaneState["serverRequestsState"];
};

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;
const OpenCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;

function mapOpenCodeChatStateForConversation(
  chatState: OpenCodeChatState,
): SessionConversationChatState {
  const activeTurnId =
    chatState.status === "busy" ? (chatState.sessionId ?? "opencode-active-turn") : null;

  return {
    activeTurnId,
    entries: chatState.entries,
    pendingTurnId: null,
    status: chatState.status === "busy" ? "inProgress" : chatState.status,
  };
}

export function shouldGenerateInitialSessionTitle(input: {
  cachedTitle: string | null | undefined;
  messageCount: number;
  sandboxInstanceId: string | null;
}): boolean {
  return (
    input.sandboxInstanceId !== null &&
    input.messageCount === 0 &&
    !(input.cachedTitle !== undefined && input.cachedTitle !== null)
  );
}

function normalizeOpenCodePermissionPatterns(
  permission: OpenCodePermissionRequest,
): readonly string[] {
  return permission.patterns.length === 0 ? [permission.permission] : permission.patterns;
}

function mapOpenCodePermissionsToServerRequests(
  pendingPermissions: readonly OpenCodePermissionRequest[],
): readonly OpenCodePermissionApprovalRequestEntry[] {
  return pendingPermissions.map((permission) => ({
    requestId: permission.id,
    method: "opencode/permission/requestApproval",
    kind: "opencode-permission",
    sessionId: permission.sessionID,
    permission: permission.permission,
    patterns: normalizeOpenCodePermissionPatterns(permission),
    availableDecisions: ["once", "always", "reject"],
    status: "pending",
    responseErrorMessage: null,
  }));
}

function resolveOpenCodePermissionResponse(
  result: unknown,
): OpenCodePermissionResponseInput["response"] {
  if (typeof result !== "object" || result === null || !("decision" in result)) {
    throw new Error("OpenCode permission response is missing a decision.");
  }

  const decision = result.decision;
  if (decision === "always" || decision === "once" || decision === "reject") {
    return decision;
  }

  throw new Error("OpenCode permission response has an unsupported decision.");
}

function buildRefreshingOpenCodeComposerBootstrap(): ReturnType<
  typeof useOpenCodeSessionState
>["bootstrap"] {
  return {
    phase: { status: "bootstrapping" },
    establishedSnapshot: {
      availableModels: [],
      configSnapshot: {
        model: null,
        modelReasoningEffort: null,
      },
    },
  };
}

function applyGeneratedSessionTitlePatch(input: {
  patchTitle: () => Promise<PatchSandboxInstanceTitleResult>;
  queryClient: QueryClient;
}): void {
  void input
    .patchTitle()
    .then((patchedTitle) => {
      applyPatchedSessionTitleToCache(input.queryClient, patchedTitle);
    })
    .catch((error: unknown) => {
      console.warn(
        error instanceof Error ? error.message : "Could not generate sandbox session title.",
      );
    });
}

type UseSessionWorkbenchControllerResult = {
  workbench: SessionWorkbenchState;
  conversationPane: SessionConversationPaneState;
};

export {
  mapOpenCodePermissionsToServerRequests,
  sandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveSandboxStatusReadState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveOpenCodePermissionResponse,
  resolveStoppedSessionMessageForWorkbenchEntryPhase,
  resolveWorkbenchEntryPhase,
  shouldWaitForAutomationSessionThread,
};
export type {
  SessionConversationPaneState,
  SessionWorkbenchState,
  UseSessionWorkbenchControllerResult,
};

export function useSessionWorkbenchController(input: {
  sandboxInstanceId: string | null;
}): UseSessionWorkbenchControllerResult {
  const queryClient = useQueryClient();
  const transportManager = useSessionWorkbenchTransport({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const sessionClientRef = useRef<AgentStreamClient | null>(null);
  const rpcClientRef = useRef<CodexJsonRpcClient | null>(null);
  const sessionEventUnsubscribersRef = useRef<(() => void)[]>([]);
  const activeHandoffRuntimeIdRef = useRef<SessionMainPanelRuntimeId>(
    CodexWorkbenchCapabilities.runtimeId,
  );
  const selectedRepositoryPathRef = useRef<string | null>(null);
  const sessionState = useCodexSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sessionClientRef,
    rpcClientRef,
    sessionEventUnsubscribersRef,
  });
  const lifecycle = sessionState.lifecycle;
  const openCodeSessionState = useOpenCodeSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const openCodeLifecycle = openCodeSessionState.lifecycle;
  const codexLifecycleForHandoff = useMemo<SessionMainPanelHandoffLifecycle>(
    () => ({
      clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
      connectSession: (connectInput): void => {
        if (connectInput.targetThreadId === null) {
          lifecycle.connectSession({
            ...(connectInput.initialCwd === undefined
              ? {}
              : { initialCwd: connectInput.initialCwd }),
            sandboxInstanceId: connectInput.sandboxInstanceId,
            ...(connectInput.selectionPolicy === undefined
              ? {}
              : { selectionPolicy: connectInput.selectionPolicy }),
            targetThreadId: null,
          });
          return;
        }

        lifecycle.connectSession({
          ...(connectInput.providerThreadId === undefined
            ? {}
            : { providerThreadId: connectInput.providerThreadId }),
          sandboxInstanceId: connectInput.sandboxInstanceId,
          targetThreadId: connectInput.targetThreadId,
        });
      },
      detachSessionConnection: lifecycle.detachSessionConnection,
      lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
      sessionConnectionState: lifecycle.sessionConnectionState,
      sessionSnapshot:
        lifecycle.sessionSnapshot === null
          ? null
          : {
              activeConversationId: lifecycle.sessionSnapshot.activeThreadId,
            },
    }),
    [
      lifecycle.clearLifecycleErrorMessage,
      lifecycle.connectSession,
      lifecycle.detachSessionConnection,
      lifecycle.lifecycleErrorMessage,
      lifecycle.sessionConnectionState,
      lifecycle.sessionSnapshot,
    ],
  );
  const openCodeLifecycleForHandoff = useMemo<SessionMainPanelHandoffLifecycle>(
    () => ({
      clearLifecycleErrorMessage: openCodeLifecycle.clearLifecycleErrorMessage,
      connectSession: (connectInput): void => {
        openCodeLifecycle.connectSession({
          ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
          sandboxInstanceId: connectInput.sandboxInstanceId,
          ...(connectInput.targetThreadId === null
            ? {}
            : { targetSessionId: connectInput.targetThreadId }),
        });
      },
      detachSessionConnection: openCodeLifecycle.detachSessionConnection,
      lifecycleErrorMessage: openCodeLifecycle.lifecycleErrorMessage,
      sessionConnectionState: openCodeLifecycle.sessionConnectionState,
      sessionSnapshot:
        openCodeLifecycle.sessionSnapshot === null
          ? null
          : {
              activeConversationId: openCodeLifecycle.sessionSnapshot.activeSessionId,
            },
    }),
    [
      openCodeLifecycle.clearLifecycleErrorMessage,
      openCodeLifecycle.connectSession,
      openCodeLifecycle.detachSessionConnection,
      openCodeLifecycle.lifecycleErrorMessage,
      openCodeLifecycle.sessionConnectionState,
      openCodeLifecycle.sessionSnapshot,
    ],
  );
  const openCodeLifecycleForWorkbench = useMemo(
    () => ({
      clearLifecycleErrorMessage: openCodeLifecycle.clearLifecycleErrorMessage,
      connectSession: (connectInput: InitialSessionConnectInput): void => {
        if (connectInput.targetThreadId === null) {
          openCodeLifecycle.connectSession({
            ...(connectInput.initialCwd === undefined
              ? {}
              : { initialCwd: connectInput.initialCwd }),
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          return;
        }

        openCodeLifecycle.connectSession({
          sandboxInstanceId: connectInput.sandboxInstanceId,
          targetThreadId: connectInput.targetThreadId,
        });
      },
      detachSessionConnection: openCodeLifecycle.detachSessionConnection,
      disconnectSession: openCodeLifecycle.disconnectSession,
      isStartingSession: openCodeLifecycle.isStartingSession,
      lifecycleErrorMessage: openCodeLifecycle.lifecycleErrorMessage,
      recoverSession: openCodeLifecycle.recoverSession,
      recoverableDisconnect: openCodeLifecycle.recoverableDisconnect,
      sessionConnectionState: openCodeLifecycle.sessionConnectionState,
      sessionSnapshot: openCodeLifecycle.sessionSnapshot,
    }),
    [
      openCodeLifecycle.clearLifecycleErrorMessage,
      openCodeLifecycle.connectSession,
      openCodeLifecycle.detachSessionConnection,
      openCodeLifecycle.disconnectSession,
      openCodeLifecycle.isStartingSession,
      openCodeLifecycle.lifecycleErrorMessage,
      openCodeLifecycle.recoverSession,
      openCodeLifecycle.recoverableDisconnect,
      openCodeLifecycle.sessionConnectionState,
      openCodeLifecycle.sessionSnapshot,
    ],
  );
  const resolveLifecycleForWorkbench = useCallback(
    (agentRuntimeId: string | null) =>
      agentRuntimeId === OpenCodeWorkbenchCapabilities.runtimeId
        ? openCodeLifecycleForWorkbench
        : lifecycle,
    [lifecycle, openCodeLifecycleForWorkbench],
  );
  const contextUsage =
    sessionState.threadTokenUsageSnapshot?.threadId ===
    sessionState.lifecycle.sessionSnapshot?.activeThreadId
      ? formatCodexContextUsage(sessionState.threadTokenUsageSnapshot)
      : null;
  const cliPtyState = useSandboxPtyState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const diffPanelState = useSessionDiffWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const chat = sessionState.chat;
  const codexConfig = sessionState.codexConfig;
  const serverRequests = sessionState.serverRequests;
  const sessionMessage = sessionState.sessionMessage;
  const codexHandoffRuntime = useMemo<SessionMainPanelHandoffRuntime>(
    () => ({
      clearActiveThreadIdAfterCliLaunch:
        sessionState.threadAuthority.clearActiveThreadIdAfterCliLaunch,
      displayName: CodexWorkbenchCapabilities.displayName,
      hydrateChatFromConversation: chat.hydrateChatFromThread,
      lifecycle: codexLifecycleForHandoff,
      preserveCliLaunchForRestore: CodexWorkbenchCapabilities.preservesCliLaunchContext,
      resetServerRequests: serverRequests.resetServerRequests,
      restoreConversationId: sessionState.threadAuthority.providerThreadId,
      resolveCliLaunchTarget: sessionState.threadAuthority.resolveCliLaunchTarget,
    }),
    [
      chat.hydrateChatFromThread,
      codexLifecycleForHandoff,
      serverRequests.resetServerRequests,
      sessionState.threadAuthority,
    ],
  );
  const openCodeHandoffRuntime = useMemo<SessionMainPanelHandoffRuntime>(
    () => ({
      clearActiveThreadIdAfterCliLaunch: () => {},
      displayName: OpenCodeWorkbenchCapabilities.displayName,
      hydrateChatFromConversation: openCodeSessionState.chat.hydrateChatFromSessionOrThrow,
      lifecycle: openCodeLifecycleForHandoff,
      preserveCliLaunchForRestore: OpenCodeWorkbenchCapabilities.preservesCliLaunchContext,
      resetServerRequests: () => {},
      restoreConversationId:
        openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null,
      resolveCliLaunchTarget: async () => {
        const activeSessionId =
          openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null;

        if (activeSessionId === null) {
          return {
            type: "start_new",
            shouldClearActiveThreadId: false,
          };
        }

        return {
          type: "resume",
          threadId: activeSessionId,
        };
      },
    }),
    [
      openCodeLifecycleForHandoff,
      openCodeSessionState.chat.hydrateChatFromSessionOrThrow,
      openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId,
    ],
  );
  const handoffRuntimes = useMemo(
    () => ({
      [CodexWorkbenchCapabilities.runtimeId]: codexHandoffRuntime,
      [OpenCodeWorkbenchCapabilities.runtimeId]: openCodeHandoffRuntime,
    }),
    [codexHandoffRuntime, openCodeHandoffRuntime],
  );

  const handoff = useSessionMainPanelHandoff({
    activeRuntimeIdRef: activeHandoffRuntimeIdRef,
    cliPtyState,
    runtimes: handoffRuntimes,
    selectedRepositoryPathRef,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const workbenchLifecycleState = useSessionWorkbenchLifecycleState({
    sandboxInstanceId: input.sandboxInstanceId,
    mainPanelTransitionState: handoff.transitionState,
    resolveLifecycle: resolveLifecycleForWorkbench,
    queryClient,
  });
  const sandboxStatus = workbenchLifecycleState.sandboxStatusQuery.data;
  const isOpenCodeRuntime =
    sandboxStatus?.runtimeContext?.agentRuntimeId === OpenCodeWorkbenchCapabilities.runtimeId;
  const activeRuntimeCapabilities = isOpenCodeRuntime
    ? OpenCodeWorkbenchCapabilities
    : CodexWorkbenchCapabilities;
  activeHandoffRuntimeIdRef.current = activeRuntimeCapabilities.runtimeId;
  const activeThreadCwd = isOpenCodeRuntime
    ? null
    : sessionState.lifecycle.sessionSnapshot?.activeThreadCwd;
  const initialSelectedRepositoryPath = resolveInitialSelectedRepositoryPath({
    activeThreadCwd: activeThreadCwd ?? undefined,
    runtimePrimaryRepositoryRoot: sandboxStatus?.runtimeContext?.primaryRepositoryRoot,
  });
  const primaryRepositoryState = useSessionPrimaryRepositoryState({
    enabled: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    initialSelectedRepositoryPath,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const selectedRepositoryPath = primaryRepositoryState.selectedRepositoryPath;
  selectedRepositoryPathRef.current = selectedRepositoryPath;
  const terminalCwd = resolveSessionTerminalCwd({
    activeThreadCwd,
    selectedRepositoryPath,
  });
  const isPrimaryRepositorySwitchBlockedByCli = handoff.isCliToggleActive;
  const branchDiffState = useSessionBranchDiff({
    cwd: selectedRepositoryPath,
    enabled: diffPanelState.isVisible && workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const repositoryStatus = useSessionRepositoryStatus({
    connectedAtIso: workbenchLifecycleState.sessionSnapshot?.connectedAtIso ?? null,
    cwd: selectedRepositoryPath,
    enabled: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    refreshEpoch: sessionState.repositoryStatusRefreshEpoch,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const portAccessState = useSessionPortAccess({
    canConnect: workbenchLifecycleState.connectionReadiness.canConnect,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
    stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
  });
  const openCodeRefreshModelCatalog = openCodeSessionState.lifecycle.refreshModelCatalog;
  const openCodeSessionConnectionState = openCodeSessionState.lifecycle.sessionConnectionState;
  const reportOpenCodeSessionError = openCodeSessionState.sessionMessage.reportSessionErrorMessage;
  useEffect(() => {
    if (!isOpenCodeRuntime || openCodeSessionConnectionState !== "connected") {
      return;
    }

    void openCodeRefreshModelCatalog({
      directory: selectedRepositoryPath,
    }).catch((error: unknown) => {
      reportOpenCodeSessionError(
        error instanceof Error ? error.message : "Could not refresh OpenCode model providers.",
      );
    });
  }, [
    isOpenCodeRuntime,
    openCodeRefreshModelCatalog,
    openCodeSessionConnectionState,
    reportOpenCodeSessionError,
    selectedRepositoryPath,
  ]);
  const openCodeComposerBootstrap = useMemo(() => {
    if (
      openCodeSessionConnectionState === "connected" &&
      openCodeSessionState.modelCatalogDirectory !== selectedRepositoryPath
    ) {
      return buildRefreshingOpenCodeComposerBootstrap();
    }

    return openCodeSessionState.bootstrap;
  }, [
    openCodeSessionState.bootstrap,
    openCodeSessionState.modelCatalogDirectory,
    openCodeSessionConnectionState,
    selectedRepositoryPath,
  ]);
  const codexComposerConfigWriter = useMemo<SessionComposerConfigWriter>(
    () => ({
      isUpdating: codexConfig.isBatchWritingConfig || codexConfig.isWritingConfigValue,
      writeModel: (model: string): void => {
        codexConfig.batchWriteConfig({
          edits: [
            {
              keyPath: "model",
              value: model,
              mergeStrategy: "replace",
            },
          ],
        });
      },
      writeReasoningEffort: (reasoningEffort: string): void => {
        codexConfig.writeConfigValue({
          keyPath: "model_reasoning_effort",
          value: reasoningEffort,
          mergeStrategy: "replace",
        });
      },
    }),
    [
      codexConfig.batchWriteConfig,
      codexConfig.isBatchWritingConfig,
      codexConfig.isWritingConfigValue,
      codexConfig.writeConfigValue,
    ],
  );
  const configControl = usePersistedSessionComposerConfigControl({
    bootstrap: sessionState.bootstrap,
    clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
    writer: codexComposerConfigWriter,
  });
  const openCodeConfigControl = useLocalSessionComposerConfigControl({
    bootstrap: openCodeComposerBootstrap,
    clearSessionErrorMessage: openCodeSessionState.sessionMessage.clearSessionErrorMessage,
    canChangeReasoningEffort: false,
    resetKey: buildOpenCodeComposerConfigResetKey(
      input.sandboxInstanceId,
      openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null,
    ),
  });
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const activeSessionThreadId = isOpenCodeRuntime
    ? null
    : (sessionSnapshot?.activeThreadId ?? null);
  const activeConversationId = isOpenCodeRuntime
    ? (openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null)
    : activeSessionThreadId;
  const enterCliDisabledReason =
    input.sandboxInstanceId === null
      ? "Session id is required."
      : sessionSnapshot === null
        ? "TUI is available after the session is connected."
        : !workbenchLifecycleState.connectionReadiness.canConnect
          ? (workbenchLifecycleState.stoppedSessionMessage ??
            "TUI is available only when the sandbox is running.")
          : handoff.transitionState !== "stable_chat"
            ? `Finish the current primary-panel transition before opening ${activeRuntimeCapabilities.displayName} TUI.`
            : null;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      input.sandboxInstanceId !== null && sessionSnapshot !== null && activeConversationId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: activeConversationId,
          }
        : null,
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const switchPrimaryRepository = useCallback(
    async (nextSelectedRepositoryPath: string | null): Promise<void> => {
      if (nextSelectedRepositoryPath === selectedRepositoryPath) {
        return;
      }

      if (!isOpenCodeRuntime) {
        await sessionState.threads.ensureCanSwitchPrimaryRepository();
      }
      primaryRepositoryState.setSelectedRepositoryPath(nextSelectedRepositoryPath);
    },
    [
      isOpenCodeRuntime,
      primaryRepositoryState.setSelectedRepositoryPath,
      selectedRepositoryPath,
      sessionState.threads.ensureCanSwitchPrimaryRepository,
    ],
  );
  const startCodexTurn = useCallback(
    async (turnInput: Parameters<SessionTurnControl["startTurn"]>[0]): Promise<void> => {
      const sandboxInstanceId = input.sandboxInstanceId;
      const cachedTitle = sandboxStatus?.title;
      const messagePayload = turnInput.transcriptPrompt ?? turnInput.submittedPrompt;
      const shouldGenerateSessionTitle = shouldGenerateInitialSessionTitle({
        sandboxInstanceId,
        cachedTitle,
        messageCount: chat.chatState.turnOrder.length,
      });

      await chat.startTurn({
        ...turnInput,
        cwd: resolvePrimaryRepositoryTurnStartCwd(selectedRepositoryPath),
      });

      if (!shouldGenerateSessionTitle || sandboxInstanceId === null) {
        return;
      }

      applyGeneratedSessionTitlePatch({
        patchTitle: () =>
          generateSessionTitleWithSandboxCodexExec({
            cwd: selectedRepositoryPath,
            ensureTransportConnected: transportManager.ensureTransportConnected,
            messagePayload,
            sandboxInstanceId,
          }),
        queryClient,
      });
    },
    [
      chat,
      input.sandboxInstanceId,
      queryClient,
      sandboxStatus?.title,
      selectedRepositoryPath,
      transportManager.ensureTransportConnected,
    ],
  );
  const startOpenCodeTurn = useCallback(
    async (turnInput: Parameters<SessionTurnControl["startTurn"]>[0]): Promise<void> => {
      const sandboxInstanceId = input.sandboxInstanceId;
      const cachedTitle = sandboxStatus?.title;
      const messagePayload = turnInput.transcriptPrompt ?? turnInput.submittedPrompt;
      const shouldGenerateSessionTitle = shouldGenerateInitialSessionTitle({
        sandboxInstanceId,
        cachedTitle,
        messageCount: openCodeSessionState.chat.chatState.messageOrder.length,
      });
      const selectedOpenCodeModel = resolveOpenCodePromptModelOverride(
        openCodeConfigControl.hasExplicitModelSelection,
        openCodeConfigControl.selectedModel,
      );
      const attachmentParts = buildOpenCodeAttachmentParts(turnInput.uploadedAttachments ?? []);
      await openCodeSessionState.chat.sendPrompt({
        ...(selectedRepositoryPath === null ? {} : { directory: selectedRepositoryPath }),
        ...(selectedOpenCodeModel === undefined ? {} : { model: selectedOpenCodeModel }),
        submittedAttachments: attachmentParts,
        submittedPrompt: messagePayload,
      });
      if (!shouldGenerateSessionTitle || sandboxInstanceId === null) {
        return;
      }

      applyGeneratedSessionTitlePatch({
        patchTitle: async () => {
          const title = await openCodeSessionState.chat.waitForGeneratedSessionTitle();
          return patchSandboxInstanceTitle({
            instanceId: sandboxInstanceId,
            onlyIfUnset: true,
            title,
          });
        },
        queryClient,
      });
    },
    [
      input.sandboxInstanceId,
      openCodeConfigControl.hasExplicitModelSelection,
      openCodeConfigControl.selectedModel,
      openCodeSessionState.chat,
      openCodeSessionState.chat.chatState.messageOrder.length,
      queryClient,
      sandboxStatus?.title,
      selectedRepositoryPath,
    ],
  );
  const isOpenCodeTurnRunning = openCodeSessionState.chat.chatState.status === "busy";
  const interruptOpenCodeTurn = useCallback((): void => {
    void openCodeSessionState.chat.abortSession();
  }, [openCodeSessionState.chat]);
  const steerOpenCodeTurn = useCallback(async (): Promise<void> => {
    throw new Error("OpenCode does not support steering an active turn.");
  }, []);
  const respondToOpenCodePermission = useCallback(
    (requestId: string | number, result: unknown): void => {
      let response: OpenCodePermissionResponseInput["response"];
      try {
        response = resolveOpenCodePermissionResponse(result);
      } catch (error) {
        openCodeSessionState.sessionMessage.reportSessionErrorMessage(
          error instanceof Error ? error.message : "Could not respond to OpenCode permission.",
        );
        return;
      }

      void openCodeSessionState.chat
        .respondToPermission({
          requestId: String(requestId),
          response,
        })
        .catch((error: unknown) => {
          openCodeSessionState.sessionMessage.reportSessionErrorMessage(
            error instanceof Error ? error.message : "Could not respond to OpenCode permission.",
          );
        });
    },
    [openCodeSessionState.chat, openCodeSessionState.sessionMessage],
  );
  const openCodePendingServerRequests = mapOpenCodePermissionsToServerRequests(
    openCodeSessionState.chat.chatState.pendingPermissions,
  );
  const codexRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () => ({
      displayName: CodexWorkbenchCapabilities.displayName,
      cliTerminalContentInset: CodexWorkbenchCapabilities.cliTerminalContentInset,
      conversation: {
        activeConversationId: activeSessionThreadId,
        chatState: chat.chatState,
        dismissUserMessageAction: chat.dismissUserMessageAction,
      },
      composerRuntimeInput: {
        bootstrap: sessionState.bootstrap,
        configControl,
        turnControl: {
          activeTurnState: chat.canInterruptTurn || chat.canSteerTurn ? "running" : "idle",
          canInterrupt: chat.canInterruptTurn,
          canSteer: CodexWorkbenchCapabilities.supportsSteering && chat.canSteerTurn,
          completedTurnErrorMessage: chat.chatState.completedErrorMessage,
          interruptTurn: chat.interruptTurn,
          isInterrupting: chat.isInterruptingTurn,
          isStarting: chat.isStartingTurn,
          isSteering: chat.isSteeringTurn,
          startTurn: startCodexTurn,
          steerTurn: chat.steerTurn,
        },
        sessionErrorMessage: sessionMessage.sessionErrorMessage,
        clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
        contextUsage: CodexWorkbenchCapabilities.hasContextUsage ? contextUsage : null,
        modelSelection: CodexWorkbenchCapabilities.composerModelSelection,
      },
      serverRequestsState: {
        isRespondingToServerRequest: serverRequests.isRespondingToServerRequest,
        pendingServerRequests: serverRequests.pendingServerRequests,
        respondToServerRequest: serverRequests.respondToServerRequest,
      },
    }),
    [
      activeSessionThreadId,
      chat.canInterruptTurn,
      chat.canSteerTurn,
      chat.chatState,
      chat.dismissUserMessageAction,
      chat.interruptTurn,
      chat.isInterruptingTurn,
      chat.isStartingTurn,
      chat.isSteeringTurn,
      chat.steerTurn,
      configControl,
      contextUsage,
      serverRequests.isRespondingToServerRequest,
      serverRequests.pendingServerRequests,
      serverRequests.respondToServerRequest,
      sessionMessage.clearSessionErrorMessage,
      sessionMessage.sessionErrorMessage,
      sessionState.bootstrap,
      startCodexTurn,
    ],
  );
  const openCodeRuntime = useMemo<SessionWorkbenchRuntimeAdapter>(
    () => ({
      displayName: OpenCodeWorkbenchCapabilities.displayName,
      cliTerminalContentInset: OpenCodeWorkbenchCapabilities.cliTerminalContentInset,
      conversation: {
        activeConversationId:
          openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId ?? null,
        chatState: mapOpenCodeChatStateForConversation(openCodeSessionState.chat.chatState),
      },
      composerRuntimeInput: {
        bootstrap: openCodeComposerBootstrap,
        configControl: openCodeConfigControl,
        turnControl: {
          activeTurnState: isOpenCodeTurnRunning ? "running" : "idle",
          canInterrupt: openCodeSessionState.chat.canInterruptTurn,
          canSteer: OpenCodeWorkbenchCapabilities.supportsSteering,
          completedTurnErrorMessage: openCodeSessionState.chat.chatState.completedErrorMessage,
          interruptTurn: interruptOpenCodeTurn,
          isInterrupting: openCodeSessionState.chat.isInterruptingTurn,
          isStarting: openCodeSessionState.chat.isStartingTurn,
          isSteering: false,
          startTurn: startOpenCodeTurn,
          steerTurn: steerOpenCodeTurn,
        },
        sessionErrorMessage: openCodeSessionState.sessionMessage.sessionErrorMessage,
        clearSessionErrorMessage: openCodeSessionState.sessionMessage.clearSessionErrorMessage,
        contextUsage: null,
        modelSelection: OpenCodeWorkbenchCapabilities.composerModelSelection,
      },
      serverRequestsState: {
        isRespondingToServerRequest: openCodeSessionState.chat.isRespondingToPermission,
        pendingServerRequests: openCodePendingServerRequests,
        respondToServerRequest: respondToOpenCodePermission,
      },
    }),
    [
      interruptOpenCodeTurn,
      isOpenCodeTurnRunning,
      openCodeComposerBootstrap,
      openCodeConfigControl,
      openCodePendingServerRequests,
      openCodeSessionState.chat.canInterruptTurn,
      openCodeSessionState.chat.chatState,
      openCodeSessionState.chat.isInterruptingTurn,
      openCodeSessionState.chat.isRespondingToPermission,
      openCodeSessionState.chat.isStartingTurn,
      openCodeSessionState.lifecycle.sessionSnapshot?.activeSessionId,
      openCodeSessionState.sessionMessage.clearSessionErrorMessage,
      openCodeSessionState.sessionMessage.sessionErrorMessage,
      respondToOpenCodePermission,
      startOpenCodeTurn,
      steerOpenCodeTurn,
    ],
  );
  const activeRuntime = isOpenCodeRuntime ? openCodeRuntime : codexRuntime;
  const sharedComposerInput: SessionComposerSharedInput = {
    attachmentControl,
    repositoryStatus,
  };

  return {
    workbench: {
      terminalCwd,
      ensureTransportConnected: transportManager.ensureTransportConnected,
      connectionReadiness: workbenchLifecycleState.connectionReadiness,
      handleTerminalWorkspaceReset: workbenchLifecycleState.handleTerminalWorkspaceReset,
      stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
      workbenchStatus: workbenchLifecycleState.workbenchStatus,
      cliPtyState,
      sandboxLifecycleStatus: workbenchLifecycleState.sandboxLifecycleStatus,
      initialEntryStartupState: workbenchLifecycleState.initialEntryStartupState,
      sandboxStatusQuery: workbenchLifecycleState.sandboxStatusQuery,
      primaryPanelState: {
        transitionState: handoff.transitionState,
        canEnterCli: enterCliDisabledReason === null,
        disabledReason: enterCliDisabledReason,
        error: handoff.error,
        isCliToggleActive: handoff.isCliToggleActive,
        showsChatComposer: handoff.transitionState === "stable_chat",
        cliTerminalContentInset: activeRuntime.cliTerminalContentInset,
        cliTerminalThemeMode: "system",
        cliRuntimeDisplayName: activeRuntime.displayName,
        enterCliMode: handoff.handoffToCli,
        exitCliMode: handoff.handoffToChat,
      },
      terminalPanelState,
      diffPanelState: {
        closePanel: diffPanelState.closePanel,
        compareLabel: branchDiffState.compareLabel,
        errorNotice: branchDiffState.errorNotice,
        isLoading: branchDiffState.isLoading,
        isVisible: diffPanelState.isVisible,
        openPanel: diffPanelState.openPanel,
        patch: branchDiffState.patch,
        togglePanel: diffPanelState.togglePanel,
      },
      primaryRepositoryState,
      portAccessState,
      primaryRepositoryControlState: {
        disabledReason:
          !isOpenCodeRuntime && isPrimaryRepositorySwitchBlockedByCli
            ? "Exit Codex TUI before switching the primary repository."
            : null,
        switchPrimaryRepository,
      },
    },
    conversationPane: {
      activeConversationId: activeRuntime.conversation.activeConversationId,
      chatState: activeRuntime.conversation.chatState,
      ...(activeRuntime.conversation.dismissUserMessageAction === undefined
        ? {}
        : { dismissUserMessageAction: activeRuntime.conversation.dismissUserMessageAction }),
      composerStateInput: {
        ...activeRuntime.composerRuntimeInput,
        ...sharedComposerInput,
      },
      serverRequestsState: activeRuntime.serverRequestsState,
    },
  };
}
