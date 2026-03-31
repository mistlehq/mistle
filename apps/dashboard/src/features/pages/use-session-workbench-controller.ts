import { resolveAgentPtyLaunchTemplate, type AgentPtyLaunchSpec } from "@mistle/integrations-core";
import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useSessionComposerAttachmentControl,
  useSessionComposerConfigControl,
  type SessionComposerStateInput,
} from "./session-composer/index.js";
import { useSessionTerminalWorkbenchState } from "./use-session-terminal-workbench-state.js";
import {
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  isActiveResumeRequest,
  reduceCodexRecoveryState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveCodexReconnectMessage,
  resolveSessionEntryPhase,
  resolveStoppedSessionMessageForEntryPhase,
  seedSandboxInstanceStatusQuery,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldWaitForAutomationSessionThread,
  useSessionWorkbenchLifecycleState,
} from "./use-session-workbench-lifecycle-state.js";

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
  sandboxStatusQuery: ReturnType<typeof useSessionWorkbenchLifecycleState>["sandboxStatusQuery"];
  sessionHeaderStatusUi: ReturnType<
    typeof useSessionWorkbenchLifecycleState
  >["sessionHeaderStatusUi"];
  lifecycleErrorMessage: string | null;
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  primaryPanelState: {
    mode: "chat" | "cli";
    isSwitching: boolean;
    canEnterCli: boolean;
    disabledReason: string | null;
    enterCliMode: () => Promise<void>;
    exitCliMode: () => Promise<void>;
  };
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
  composerStateInput: SessionComposerStateInput;
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

function resolveCompiledAgentPtyLaunch(input: {
  sandboxStatus: SandboxInstanceStatusResult | undefined;
}): AgentPtyLaunchSpec | null {
  const runtimePlan = input.sandboxStatus?.runtimePlan;
  if (runtimePlan === undefined || runtimePlan === null) {
    return null;
  }

  const agentRuntime = runtimePlan.agentRuntimes[0];
  if (agentRuntime === undefined) {
    return null;
  }

  if (runtimePlan.agentRuntimes[1] !== undefined) {
    throw new Error("Expected at most one compiled agent runtime for session CLI launch.");
  }

  return agentRuntime.ptyLaunch;
}

export {
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  hasFreshSandboxStatusReadSinceRecoveryBoundary,
  isActiveResumeRequest,
  reduceCodexRecoveryState,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveCodexReconnectMessage,
  resolveSessionEntryPhase,
  resolveStoppedSessionMessageForEntryPhase,
  seedSandboxInstanceStatusQuery,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
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
  const sessionState = useCodexSessionState();
  const [primaryPanelMode, setPrimaryPanelMode] = useState<"chat" | "cli">("chat");
  const [isSwitchingPrimaryPanel, setIsSwitchingPrimaryPanel] = useState(false);
  const shouldHydrateAfterCliExitRef = useRef(false);
  const chatTransportPolicy =
    primaryPanelMode === "cli" ? ("detached_for_cli" as const) : ("auto_attach" as const);
  const ptyState = useSandboxPtyState();
  const cliPtyState = useSandboxPtyState();
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const lifecycle = sessionState.lifecycle;
  const chat = sessionState.chat;
  const codexConfig = sessionState.codexConfig;
  const serverRequests = sessionState.serverRequests;
  const sessionMessage = sessionState.sessionMessage;

  const workbenchLifecycleState = useSessionWorkbenchLifecycleState({
    sandboxInstanceId: input.sandboxInstanceId,
    chatTransportPolicy,
    lifecycle,
    ptyState,
    queryClient,
  });
  const configControl = useSessionComposerConfigControl({
    bootstrap: sessionState.bootstrap,
    clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
    codexConfig,
  });
  const sessionSnapshot = workbenchLifecycleState.sessionSnapshot;
  const cliPtyLaunch = resolveCompiledAgentPtyLaunch({
    sandboxStatus: workbenchLifecycleState.sandboxStatusQuery.data,
  });
  const enterCliDisabledReason =
    input.sandboxInstanceId === null
      ? "Session id is required."
      : sessionSnapshot === null
        ? "CLI is available after the session is connected."
        : cliPtyLaunch === null
          ? "CLI is unavailable because this sandbox does not expose a PTY launch template."
          : !workbenchLifecycleState.connectionReadiness.canConnect
            ? (workbenchLifecycleState.stoppedSessionState.message ??
              "CLI is available only when the sandbox is running.")
            : null;
  const canEnterCli = enterCliDisabledReason === null && !isSwitchingPrimaryPanel;
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget:
      input.sandboxInstanceId !== null &&
      sessionSnapshot !== null &&
      sessionSnapshot.threadId !== null
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            threadId: sessionSnapshot.threadId,
          }
        : null,
  });

  const enterCliMode = useCallback(async (): Promise<void> => {
    if (
      input.sandboxInstanceId === null ||
      sessionSnapshot === null ||
      cliPtyLaunch === null ||
      !workbenchLifecycleState.connectionReadiness.canConnect ||
      isSwitchingPrimaryPanel
    ) {
      return;
    }

    setIsSwitchingPrimaryPanel(true);
    try {
      const resolvedCliLaunch = resolveAgentPtyLaunchTemplate({
        launch: cliPtyLaunch,
        threadId: sessionSnapshot.threadId,
      });
      setPrimaryPanelMode("cli");
      lifecycle.detachSessionTransport();
      serverRequests.resetServerRequests();
      await cliPtyState.actions.openPty({
        sandboxInstanceId: input.sandboxInstanceId,
        ptySessionId: resolvedCliLaunch.ptySessionId,
        cols: resolvedCliLaunch.cols,
        rows: resolvedCliLaunch.rows,
        ...(resolvedCliLaunch.cwd === undefined ? {} : { cwd: resolvedCliLaunch.cwd }),
        command: resolvedCliLaunch.command,
        args: resolvedCliLaunch.args,
      });
    } finally {
      setIsSwitchingPrimaryPanel(false);
    }
  }, [
    cliPtyState.actions,
    input.sandboxInstanceId,
    isSwitchingPrimaryPanel,
    lifecycle,
    serverRequests,
    cliPtyLaunch,
    sessionSnapshot,
    workbenchLifecycleState.connectionReadiness.canConnect,
  ]);

  const exitCliMode = useCallback(async (): Promise<void> => {
    if (primaryPanelMode !== "cli" || input.sandboxInstanceId === null || isSwitchingPrimaryPanel) {
      return;
    }

    setIsSwitchingPrimaryPanel(true);
    serverRequests.resetServerRequests();
    shouldHydrateAfterCliExitRef.current = true;
    setPrimaryPanelMode("chat");
    if (sessionSnapshot !== null) {
      lifecycle.connectSession({
        sandboxInstanceId: input.sandboxInstanceId,
        preferredThreadId: sessionSnapshot.threadId,
      });
    }

    try {
      if (cliPtyState.lifecycle.state === SandboxPtyStates.OPEN) {
        try {
          await cliPtyState.actions.closePty();
        } catch {
          // Returning to chat must not depend on the CLI PTY still being closable.
        }
      }
      try {
        await cliPtyState.actions.disconnectPty();
      } catch {
        // Returning to chat must not depend on the CLI PTY websocket disconnect succeeding.
      }
    } finally {
      setIsSwitchingPrimaryPanel(false);
    }
  }, [
    cliPtyState.actions,
    cliPtyState.lifecycle.state,
    input.sandboxInstanceId,
    isSwitchingPrimaryPanel,
    lifecycle,
    primaryPanelMode,
    sessionSnapshot,
    serverRequests,
  ]);

  useEffect(() => {
    if (!shouldHydrateAfterCliExitRef.current) {
      return;
    }

    if (primaryPanelMode !== "chat" || lifecycle.transportState !== "connected") {
      return;
    }

    shouldHydrateAfterCliExitRef.current = false;
    void chat.hydrateChatFromThread().catch(() => {});
  }, [chat, lifecycle.transportState, primaryPanelMode]);

  useEffect(() => {
    if (
      primaryPanelMode !== "cli" ||
      cliPtyState.lifecycle.exitInfo === null ||
      input.sandboxInstanceId === null ||
      isSwitchingPrimaryPanel
    ) {
      return;
    }

    serverRequests.resetServerRequests();
    shouldHydrateAfterCliExitRef.current = true;
    setPrimaryPanelMode("chat");
    if (sessionSnapshot !== null) {
      lifecycle.connectSession({
        sandboxInstanceId: input.sandboxInstanceId,
        preferredThreadId: sessionSnapshot.threadId,
      });
    }
    void cliPtyState.actions.disconnectPty().catch(() => {});
  }, [
    cliPtyState.actions,
    cliPtyState.lifecycle.exitInfo,
    input.sandboxInstanceId,
    isSwitchingPrimaryPanel,
    lifecycle,
    primaryPanelMode,
    serverRequests,
    sessionSnapshot,
  ]);

  return {
    workbench: {
      connectionReadiness: workbenchLifecycleState.connectionReadiness,
      stoppedSessionState: workbenchLifecycleState.stoppedSessionState,
      hasTopAlert: workbenchLifecycleState.hasTopAlert,
      isResumingStoppedSandbox: workbenchLifecycleState.isResumingStoppedSandbox,
      sessionReconnectState: workbenchLifecycleState.sessionReconnectState,
      shouldAutoResumeOnEntry: workbenchLifecycleState.shouldAutoResumeOnEntry,
      ptyState,
      cliPtyState,
      requestStoppedSandboxResume: workbenchLifecycleState.requestStoppedSandboxResume,
      sandboxLifecycleStatus: workbenchLifecycleState.sandboxLifecycleStatus,
      sandboxFailureMessage: workbenchLifecycleState.sandboxFailureMessage,
      sandboxStatusQuery: workbenchLifecycleState.sandboxStatusQuery,
      sessionHeaderStatusUi: workbenchLifecycleState.sessionHeaderStatusUi,
      lifecycleErrorMessage: workbenchLifecycleState.lifecycleErrorMessage,
      primaryPanelState: {
        mode: primaryPanelMode,
        isSwitching: isSwitchingPrimaryPanel,
        canEnterCli,
        disabledReason: enterCliDisabledReason,
        enterCliMode,
        exitCliMode,
      },
      terminalPanelState,
    },
    conversationPane: {
      chatState: chat.chatState,
      composerStateInput: {
        bootstrap: sessionState.bootstrap,
        configControl,
        attachmentControl,
        turnControl: {
          activeTurnState: chat.canInterruptTurn || chat.canSteerTurn ? "running" : "idle",
          canInterrupt: chat.canInterruptTurn,
          canSteer: chat.canSteerTurn,
          completedTurnErrorMessage: chat.chatState.completedErrorMessage,
          interruptTurn: chat.interruptTurn,
          isInterrupting: chat.isInterruptingTurn,
          isStarting: chat.isStartingTurn,
          isSteering: chat.isSteeringTurn,
          startTurn: chat.startTurn,
          steerTurn: chat.steerTurn,
        },
        sessionErrorMessage: sessionMessage.sessionErrorMessage,
        clearSessionErrorMessage: sessionMessage.clearSessionErrorMessage,
      },
      serverRequestsState: {
        isRespondingToServerRequest: serverRequests.isRespondingToServerRequest,
        pendingServerRequests: serverRequests.pendingServerRequests,
        respondToServerRequest: serverRequests.respondToServerRequest,
      },
    },
  };
}
