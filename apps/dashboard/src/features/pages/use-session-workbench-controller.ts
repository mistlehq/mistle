import type {
  CodexJsonRpcClient,
  AgentStreamClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type {
  OpenCodePermissionRequest,
  OpenCodePermissionResponseInput,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ChatState } from "../chat/chat-state.js";
import { formatCodexContextUsage } from "../session-agents/codex/session-state/codex-context-usage.js";
import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import {
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
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useLocalSessionComposerConfigControl,
  useSessionComposerAttachmentControl,
  useSessionComposerConfigControl,
  type SessionComposerStateInput,
} from "./session-composer/index.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  resolveInitialSelectedRepositoryPath,
  resolvePrimaryRepositoryTurnStartCwd,
  resolveSessionTerminalCwd,
} from "./session-primary-repository-policy.js";
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
import {
  reduceCodexRecoveryState,
  resolveCodexRecoveryStateForRender,
  resolveCodexReconnectMessage,
} from "./use-session-workbench-codex-recovery.js";
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
  lifecycleStep: ReturnType<typeof useCodexSessionState>["lifecycle"]["step"];
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
    cliRuntimeDisplayName: "Codex" | "OpenCode";
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
  activeThreadId: string | null;
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
  reduceCodexRecoveryState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveCodexRecoveryStateForRender,
  resolveCodexReconnectMessage,
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
  const activeHandoffRuntimeIdRef = useRef<SessionMainPanelRuntimeId>("codex");
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
  const opencodeLifecycleForWorkbench = useMemo(
    () => ({
      clearLifecycleErrorMessage: openCodeLifecycle.clearLifecycleErrorMessage,
      connectSession: (connectInput: Parameters<typeof lifecycle.connectSession>[0]): void => {
        const targetThreadId = connectInput.targetThreadId;
        openCodeLifecycle.connectSession({
          ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
          sandboxInstanceId: connectInput.sandboxInstanceId,
          ...(targetThreadId === null ? {} : { targetThreadId }),
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
      displayName: "Codex",
      hydrateChatFromConversation: chat.hydrateChatFromThread,
      lifecycle: codexLifecycleForHandoff,
      preserveCliLaunchForRestore: false,
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
      displayName: "OpenCode",
      hydrateChatFromConversation: openCodeSessionState.chat.hydrateChatFromSessionOrThrow,
      lifecycle: openCodeLifecycleForHandoff,
      preserveCliLaunchForRestore: true,
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
      codex: codexHandoffRuntime,
      opencode: openCodeHandoffRuntime,
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
    lifecycle,
    opencodeLifecycle: opencodeLifecycleForWorkbench,
    queryClient,
  });
  const sandboxStatus = workbenchLifecycleState.sandboxStatusQuery.data;
  const isOpenCodeRuntime = sandboxStatus?.runtimeContext?.agentRuntimeId === "opencode";
  activeHandoffRuntimeIdRef.current = isOpenCodeRuntime ? "opencode" : "codex";
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
      return {
        phase: { status: "bootstrapping" as const },
        establishedSnapshot: {
          availableModels: [],
          configSnapshot: {
            model: null,
            modelReasoningEffort: null,
          },
        },
      };
    }

    return openCodeSessionState.bootstrap;
  }, [
    openCodeSessionState.bootstrap,
    openCodeSessionState.modelCatalogDirectory,
    openCodeSessionConnectionState,
    selectedRepositoryPath,
  ]);
  const configControl = useSessionComposerConfigControl({
    bootstrap: sessionState.bootstrap,
    clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
    codexConfig,
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
  const activeConfigControl = isOpenCodeRuntime ? openCodeConfigControl : configControl;
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const activeSessionThreadId = isOpenCodeRuntime
    ? null
    : (sessionSnapshot?.activeThreadId ?? null);
  const activeConversationThreadId = isOpenCodeRuntime
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
            ? `Finish the current primary-panel transition before opening ${
                isOpenCodeRuntime ? "OpenCode" : "Codex"
              } TUI.`
            : null;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      !isOpenCodeRuntime &&
      input.sandboxInstanceId !== null &&
      sessionSnapshot !== null &&
      activeSessionThreadId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: activeSessionThreadId,
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
  const startTurn = useCallback(
    async (turnInput: Parameters<typeof chat.startTurn>[0]): Promise<void> => {
      if (isOpenCodeRuntime) {
        const selectedOpenCodeModel = resolveOpenCodePromptModelOverride(
          activeConfigControl.hasExplicitModelSelection,
          activeConfigControl.selectedModel,
        );
        await openCodeSessionState.chat.sendPrompt({
          ...(selectedRepositoryPath === null ? {} : { directory: selectedRepositoryPath }),
          ...(selectedOpenCodeModel === undefined ? {} : { model: selectedOpenCodeModel }),
          submittedPrompt: turnInput.transcriptPrompt ?? turnInput.submittedPrompt,
        });
        return;
      }

      const sandboxInstanceId = input.sandboxInstanceId;
      const cachedTitle = sandboxStatus?.title;
      const shouldGenerateSessionTitle =
        sandboxInstanceId !== null &&
        chat.chatState.turnOrder.length === 0 &&
        !(cachedTitle !== undefined && cachedTitle !== null);

      await chat.startTurn({
        ...turnInput,
        cwd: resolvePrimaryRepositoryTurnStartCwd(selectedRepositoryPath),
      });

      if (!shouldGenerateSessionTitle || sandboxInstanceId === null) {
        return;
      }

      void generateSessionTitleWithSandboxCodexExec({
        cwd: selectedRepositoryPath,
        ensureTransportConnected: transportManager.ensureTransportConnected,
        messagePayload: turnInput.transcriptPrompt ?? turnInput.submittedPrompt,
        sandboxInstanceId,
      })
        .then((patchedTitle) => {
          applyPatchedSessionTitleToCache(queryClient, patchedTitle);
        })
        .catch((error: unknown) => {
          console.warn(
            error instanceof Error ? error.message : "Could not generate sandbox session title.",
          );
        });
    },
    [
      chat,
      activeConfigControl.hasExplicitModelSelection,
      activeConfigControl.selectedModel,
      input.sandboxInstanceId,
      isOpenCodeRuntime,
      openCodeSessionState.chat,
      queryClient,
      sandboxStatus?.title,
      selectedRepositoryPath,
      transportManager.ensureTransportConnected,
    ],
  );
  const activeConversationChatState = isOpenCodeRuntime
    ? mapOpenCodeChatStateForConversation(openCodeSessionState.chat.chatState)
    : chat.chatState;
  const activeSessionErrorMessage = isOpenCodeRuntime
    ? openCodeSessionState.sessionMessage.sessionErrorMessage
    : sessionMessage.sessionErrorMessage;
  const activeClearSessionErrorMessage = isOpenCodeRuntime
    ? openCodeSessionState.sessionMessage.clearSessionErrorMessage
    : sessionMessage.clearSessionErrorMessage;
  const isOpenCodeTurnRunning = openCodeSessionState.chat.chatState.status === "busy";
  const interruptOpenCodeTurn = useCallback((): void => {
    void openCodeSessionState.chat.abortSession();
  }, [openCodeSessionState.chat]);
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
      lifecycleStep: isOpenCodeRuntime ? openCodeSessionState.lifecycle.step : lifecycle.step,
      primaryPanelState: {
        transitionState: handoff.transitionState,
        canEnterCli: enterCliDisabledReason === null,
        disabledReason: enterCliDisabledReason,
        error: handoff.error,
        isCliToggleActive: handoff.isCliToggleActive,
        showsChatComposer: handoff.transitionState === "stable_chat",
        cliTerminalContentInset: isOpenCodeRuntime ? "none" : "default",
        cliTerminalThemeMode: "system",
        cliRuntimeDisplayName: isOpenCodeRuntime ? "OpenCode" : "Codex",
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
      activeThreadId: activeConversationThreadId,
      chatState: activeConversationChatState,
      ...(isOpenCodeRuntime ? {} : { dismissUserMessageAction: chat.dismissUserMessageAction }),
      composerStateInput: {
        bootstrap: isOpenCodeRuntime ? openCodeComposerBootstrap : sessionState.bootstrap,
        configControl: activeConfigControl,
        attachmentControl,
        turnControl: {
          activeTurnState: isOpenCodeRuntime
            ? isOpenCodeTurnRunning
              ? "running"
              : "idle"
            : chat.canInterruptTurn || chat.canSteerTurn
              ? "running"
              : "idle",
          canInterrupt: isOpenCodeRuntime
            ? openCodeSessionState.chat.canInterruptTurn
            : chat.canInterruptTurn,
          canSteer: isOpenCodeRuntime ? false : chat.canSteerTurn,
          completedTurnErrorMessage: isOpenCodeRuntime
            ? openCodeSessionState.chat.chatState.completedErrorMessage
            : chat.chatState.completedErrorMessage,
          interruptTurn: isOpenCodeRuntime ? interruptOpenCodeTurn : chat.interruptTurn,
          isInterrupting: isOpenCodeRuntime
            ? openCodeSessionState.chat.isInterruptingTurn
            : chat.isInterruptingTurn,
          isStarting: isOpenCodeRuntime
            ? openCodeSessionState.chat.isStartingTurn
            : chat.isStartingTurn,
          isSteering: isOpenCodeRuntime ? false : chat.isSteeringTurn,
          startTurn,
          steerTurn: chat.steerTurn,
        },
        sessionErrorMessage: activeSessionErrorMessage,
        clearSessionErrorMessage: activeClearSessionErrorMessage,
        repositoryStatus,
        contextUsage: isOpenCodeRuntime ? null : contextUsage,
        requiresModelSelection: !isOpenCodeRuntime,
        showConfigControls: true,
      },
      serverRequestsState: {
        isRespondingToServerRequest: isOpenCodeRuntime
          ? openCodeSessionState.chat.isRespondingToPermission
          : serverRequests.isRespondingToServerRequest,
        pendingServerRequests: isOpenCodeRuntime
          ? openCodePendingServerRequests
          : serverRequests.pendingServerRequests,
        respondToServerRequest: isOpenCodeRuntime
          ? respondToOpenCodePermission
          : serverRequests.respondToServerRequest,
      },
    },
  };
}
