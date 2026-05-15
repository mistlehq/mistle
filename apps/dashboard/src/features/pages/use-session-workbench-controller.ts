import type {
  CodexJsonRpcClient,
  AgentStreamClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { useOpenCodeSessionState } from "../session-agents/opencode/session-state/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "../session-agents/session-runtime-workbench-capabilities.js";
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
import {
  useSessionMainPanelHandoff,
  type SessionMainPanelRuntimeId,
} from "./use-session-main-panel-handoff.js";
import type { SessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";
import {
  useSessionWorkbenchChromeState,
  type SessionWorkbenchChromeState,
} from "./use-session-workbench-chrome-state.js";
import {
  useSessionWorkbenchConversationRuntime,
  type SessionConversationPaneState,
} from "./use-session-workbench-conversation-runtime.js";
import { useSessionWorkbenchHandoffControl } from "./use-session-workbench-handoff-control.js";
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
  terminalPanelState: SessionWorkbenchChromeState["terminalPanelState"];
  diffPanelState: SessionWorkbenchChromeState["diffPanelState"];
  primaryRepositoryState: SessionPrimaryRepositoryState;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  portAccessState: SessionWorkbenchChromeState["portAccessState"];
};

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;

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
  const openCodeSessionState = useOpenCodeSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const { cliPtyState, handoff, resolveLifecycleForWorkbench } = useSessionWorkbenchHandoffControl({
    activeHandoffRuntimeIdRef,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    openCodeSessionState,
    sandboxInstanceId: input.sandboxInstanceId,
    selectedRepositoryPathRef,
    sessionState,
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
  const chromeState = useSessionWorkbenchChromeState({
    canConnect: workbenchLifecycleState.connectionReadiness.canConnect,
    connectedAtIso: workbenchLifecycleState.sessionSnapshot?.connectedAtIso ?? null,
    ensureTransportConnected: transportManager.ensureTransportConnected,
    repositoryStatusRefreshEpoch: sessionState.repositoryStatusRefreshEpoch,
    sandboxInstanceId: input.sandboxInstanceId,
    selectedRepositoryPath,
    stoppedSessionMessage: workbenchLifecycleState.stoppedSessionMessage,
  });
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const conversationRuntime = useSessionWorkbenchConversationRuntime({
    ensureTransportConnected: transportManager.ensureTransportConnected,
    isOpenCodeRuntime,
    openCodeSessionState,
    queryClient,
    repositoryStatus: chromeState.repositoryStatus,
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
      terminalPanelState: chromeState.terminalPanelState,
      diffPanelState: chromeState.diffPanelState,
      primaryRepositoryState: repositoryControl.primaryRepositoryState,
      portAccessState: chromeState.portAccessState,
      primaryRepositoryControlState: repositoryControl.primaryRepositoryControlState,
    },
    conversationPane: conversationRuntime.conversationPane,
  };
}
