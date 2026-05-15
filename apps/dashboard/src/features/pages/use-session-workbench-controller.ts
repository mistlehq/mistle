import type {
  CodexJsonRpcClient,
  AgentStreamClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { useOpenCodeSessionState } from "../session-agents/opencode/session-state/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "../session-agents/session-runtime-workbench-capabilities.js";
import {
  buildCodexHandoffRuntime,
  buildCodexLifecycleForHandoff,
  buildOpenCodeHandoffRuntime,
  buildOpenCodeLifecycleForHandoff,
  buildOpenCodeLifecycleForWorkbench,
  resolveSessionLifecycleForWorkbench,
} from "../session-agents/session-workbench-handoff-runtimes.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { type MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
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
  type SessionMainPanelRuntimeId,
} from "./use-session-main-panel-handoff.js";
import { useSessionPortAccess } from "./use-session-port-access.js";
import type { SessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";
import { useSessionRepositoryStatus } from "./use-session-repository-status.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import {
  useSessionWorkbenchConversationRuntime,
  type SessionConversationPaneState,
} from "./use-session-workbench-conversation-runtime.js";
import { useSessionWorkbenchLifecycleState } from "./use-session-workbench-lifecycle-state.js";
import { useSessionWorkbenchRepositoryControl } from "./use-session-workbench-repository-control.js";
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
  primaryRepositoryState: SessionPrimaryRepositoryState;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  portAccessState: ReturnType<typeof useSessionPortAccess>;
};

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;
const OpenCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;

type UseSessionWorkbenchControllerResult = {
  workbench: SessionWorkbenchState;
  conversationPane: SessionConversationPaneState;
};

export {
  sandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  resolveSandboxStatusReadState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
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
  const codexLifecycleForHandoff = useMemo(
    () => buildCodexLifecycleForHandoff(lifecycle),
    [
      lifecycle.clearLifecycleErrorMessage,
      lifecycle.connectSession,
      lifecycle.detachSessionConnection,
      lifecycle.lifecycleErrorMessage,
      lifecycle.sessionConnectionState,
      lifecycle.sessionSnapshot,
    ],
  );
  const openCodeLifecycleForHandoff = useMemo(
    () => buildOpenCodeLifecycleForHandoff(openCodeLifecycle),
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
    () => buildOpenCodeLifecycleForWorkbench(openCodeLifecycle),
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
      resolveSessionLifecycleForWorkbench({
        agentRuntimeId,
        codexLifecycle: lifecycle,
        openCodeLifecycle: openCodeLifecycleForWorkbench,
      }),
    [lifecycle, openCodeLifecycleForWorkbench],
  );
  const cliPtyState = useSandboxPtyState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const diffPanelState = useSessionDiffWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const codexHandoffRuntime = useMemo(
    () =>
      buildCodexHandoffRuntime({
        chat: sessionState.chat,
        lifecycle: codexLifecycleForHandoff,
        serverRequests: sessionState.serverRequests,
        threadAuthority: sessionState.threadAuthority,
      }),
    [
      sessionState.chat.hydrateChatFromThread,
      codexLifecycleForHandoff,
      sessionState.serverRequests.resetServerRequests,
      sessionState.threadAuthority.clearActiveThreadIdAfterCliLaunch,
      sessionState.threadAuthority.providerThreadId,
      sessionState.threadAuthority.resolveCliLaunchTarget,
    ],
  );
  const openCodeHandoffRuntime = useMemo(
    () =>
      buildOpenCodeHandoffRuntime({
        chat: openCodeSessionState.chat,
        lifecycle: openCodeLifecycleForHandoff,
        sessionSnapshot: openCodeSessionState.lifecycle.sessionSnapshot,
      }),
    [
      openCodeLifecycleForHandoff,
      openCodeSessionState.chat.hydrateChatFromSessionOrThrow,
      openCodeSessionState.lifecycle.sessionSnapshot,
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
  const repositoryControl = useSessionWorkbenchRepositoryControl({
    activeHandoffRuntimeIdRef,
    canConnect: workbenchLifecycleState.connectionReadiness.canConnect,
    codexActiveThreadCwd: sessionState.lifecycle.sessionSnapshot?.activeThreadCwd,
    ensureCanSwitchPrimaryRepository: sessionState.threads.ensureCanSwitchPrimaryRepository,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    isCliToggleActive: handoff.isCliToggleActive,
    runtimeAgentRuntimeId: sandboxStatus?.runtimeContext?.agentRuntimeId,
    runtimePrimaryRepositoryRoot: sandboxStatus?.runtimeContext?.primaryRepositoryRoot,
    sandboxInstanceId: input.sandboxInstanceId,
    selectedRepositoryPathRef,
  });
  const isOpenCodeRuntime = repositoryControl.isOpenCodeRuntime;
  const selectedRepositoryPath = repositoryControl.selectedRepositoryPath;
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
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const conversationRuntime = useSessionWorkbenchConversationRuntime({
    ensureTransportConnected: transportManager.ensureTransportConnected,
    isOpenCodeRuntime,
    openCodeSessionState,
    queryClient,
    repositoryStatus,
    sandboxInstanceId: input.sandboxInstanceId,
    sandboxStatus,
    selectedRepositoryPath,
    sessionSnapshot,
    sessionState,
  });
  const enterCliDisabledReason =
    input.sandboxInstanceId === null
      ? "Session id is required."
      : sessionSnapshot === null
        ? "TUI is available after the session is connected."
        : !workbenchLifecycleState.connectionReadiness.canConnect
          ? (workbenchLifecycleState.stoppedSessionMessage ??
            "TUI is available only when the sandbox is running.")
          : handoff.transitionState !== "stable_chat"
            ? `Finish the current primary-panel transition before opening ${conversationRuntime.cliRuntimeDisplayName} TUI.`
            : null;

  return {
    workbench: {
      terminalCwd: repositoryControl.terminalCwd,
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
        cliTerminalContentInset: conversationRuntime.cliTerminalContentInset,
        cliTerminalThemeMode: "system",
        cliRuntimeDisplayName: conversationRuntime.cliRuntimeDisplayName,
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
      primaryRepositoryState: repositoryControl.primaryRepositoryState,
      portAccessState,
      primaryRepositoryControlState: repositoryControl.primaryRepositoryControlState,
    },
    conversationPane: conversationRuntime.conversationPane,
  };
}
