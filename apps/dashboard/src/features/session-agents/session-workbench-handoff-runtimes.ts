import type { InitialSessionConnectInput } from "../pages/session-initial-connect-policy.js";
import type {
  SessionMainPanelHandoffLifecycle,
  SessionMainPanelHandoffRuntime,
} from "../pages/use-session-main-panel-handoff.js";
import type { SessionLifecycleForWorkbench } from "../pages/use-session-workbench-lifecycle-state.js";
import {
  buildCodexCliPtyOpenInput,
  type UseCodexSessionStateResult,
} from "./codex/session-state/index.js";
import {
  buildOpenCodeCliPtyOpenInput,
  type UseOpenCodeSessionStateResult,
} from "./opencode/session-state/index.js";
import { buildPiCliPtyOpenInput, type UsePiSessionStateResult } from "./pi/session-state/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "./session-runtime-workbench-capabilities.js";

type RuntimeConversationConnectInput =
  | InitialSessionConnectInput
  | Parameters<SessionMainPanelHandoffLifecycle["connectSession"]>[0];

type CodexConnectSessionInput = Parameters<
  UseCodexSessionStateResult["lifecycle"]["connectSession"]
>[0];
type OpenCodeConnectSessionInput = Parameters<
  UseOpenCodeSessionStateResult["lifecycle"]["connectSession"]
>[0];
type PiConnectSessionInput = Parameters<UsePiSessionStateResult["lifecycle"]["connectSession"]>[0];

function toCodexConnectSessionInput(
  connectInput: RuntimeConversationConnectInput,
): CodexConnectSessionInput {
  if (connectInput.targetRuntimeConversationId === null) {
    return {
      ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
      sandboxInstanceId: connectInput.sandboxInstanceId,
      ...(connectInput.selectionPolicy === undefined
        ? {}
        : { selectionPolicy: connectInput.selectionPolicy }),
      targetThreadId: null,
    };
  }

  const missingTargetThreadAction =
    "missingTargetRuntimeConversationAction" in connectInput
      ? connectInput.missingTargetRuntimeConversationAction
      : undefined;

  return {
    ...(missingTargetThreadAction === undefined ? {} : { missingTargetThreadAction }),
    ...(connectInput.providerConversationId === undefined
      ? {}
      : { providerThreadId: connectInput.providerConversationId }),
    sandboxInstanceId: connectInput.sandboxInstanceId,
    targetThreadId: connectInput.targetRuntimeConversationId,
  };
}

function toOpenCodeConnectSessionInput(
  connectInput: RuntimeConversationConnectInput,
): OpenCodeConnectSessionInput {
  return {
    ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
    ...(connectInput.providerConversationId === undefined ||
    connectInput.providerConversationId === null
      ? {}
      : { providerSessionId: connectInput.providerConversationId }),
    sandboxInstanceId: connectInput.sandboxInstanceId,
    ...(connectInput.targetRuntimeConversationId === null
      ? {}
      : { targetSessionId: connectInput.targetRuntimeConversationId }),
  };
}

function toPiConnectSessionInput(
  connectInput: RuntimeConversationConnectInput,
): PiConnectSessionInput {
  return {
    ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
    ...(connectInput.providerConversationId === undefined ||
    connectInput.providerConversationId === null
      ? {}
      : { providerConversationId: connectInput.providerConversationId }),
    sandboxInstanceId: connectInput.sandboxInstanceId,
    ...(connectInput.targetRuntimeConversationId === null
      ? {}
      : { targetConversationId: connectInput.targetRuntimeConversationId }),
  };
}

export function buildCodexLifecycleForHandoff(
  lifecycle: UseCodexSessionStateResult["lifecycle"],
): SessionMainPanelHandoffLifecycle {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput): void => {
      lifecycle.connectSession(toCodexConnectSessionInput(connectInput));
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
  };
}

export function buildOpenCodeLifecycleForHandoff(
  lifecycle: UseOpenCodeSessionStateResult["lifecycle"],
): SessionMainPanelHandoffLifecycle {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput): void => {
      lifecycle.connectSession(toOpenCodeConnectSessionInput(connectInput));
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeConversationId: lifecycle.sessionSnapshot.activeSessionId,
          },
  };
}

export function buildOpenCodeLifecycleForWorkbench(
  lifecycle: UseOpenCodeSessionStateResult["lifecycle"],
): SessionLifecycleForWorkbench {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput: InitialSessionConnectInput): void => {
      lifecycle.connectSession(toOpenCodeConnectSessionInput(connectInput));
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    disconnectSession: lifecycle.disconnectSession,
    isStartingSession: lifecycle.isStartingSession,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    recoverSession: (recoverInput): void => {
      lifecycle.recoverSession({
        sandboxInstanceId: recoverInput.sandboxInstanceId,
        targetSessionId: recoverInput.targetRuntimeConversationId,
      });
    },
    recoverableDisconnect: null,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeRuntimeConversationId: lifecycle.sessionSnapshot.activeSessionId,
            connectedAtIso: lifecycle.sessionSnapshot.connectedAtIso,
            providerConversationId: lifecycle.sessionSnapshot.providerSessionId,
            sandboxInstanceId: lifecycle.sessionSnapshot.sandboxInstanceId,
          },
  };
}

export function buildCodexLifecycleForWorkbench(
  lifecycle: UseCodexSessionStateResult["lifecycle"],
): SessionLifecycleForWorkbench {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput: InitialSessionConnectInput): void => {
      lifecycle.connectSession(toCodexConnectSessionInput(connectInput));
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    disconnectSession: lifecycle.disconnectSession,
    isStartingSession: lifecycle.isStartingSession,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    recoverSession: (recoverInput): void => {
      lifecycle.recoverSession({
        sandboxInstanceId: recoverInput.sandboxInstanceId,
        targetThreadId: recoverInput.targetRuntimeConversationId,
      });
    },
    recoverableDisconnect:
      lifecycle.recoverableDisconnect === null
        ? null
        : {
            id: lifecycle.recoverableDisconnect.id,
            isGatewayServiceRestart: lifecycle.recoverableDisconnect.isGatewayServiceRestart,
            message: lifecycle.recoverableDisconnect.message,
            targetRuntimeConversationId: lifecycle.recoverableDisconnect.targetThreadId,
            recoveryStrategy: lifecycle.recoverableDisconnect.recoveryStrategy,
          },
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeRuntimeConversationCwd: lifecycle.sessionSnapshot.activeThreadCwd,
            activeRuntimeConversationId: lifecycle.sessionSnapshot.activeThreadId,
            connectedAtIso: lifecycle.sessionSnapshot.connectedAtIso,
            providerConversationId: lifecycle.sessionSnapshot.providerThreadId,
            sandboxInstanceId: lifecycle.sessionSnapshot.sandboxInstanceId,
          },
  };
}

export function buildPiLifecycleForHandoff(
  lifecycle: UsePiSessionStateResult["lifecycle"],
): SessionMainPanelHandoffLifecycle {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput): void => {
      lifecycle.connectSession(toPiConnectSessionInput(connectInput));
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeConversationId: lifecycle.sessionSnapshot.activeConversationId,
          },
  };
}

export function buildPiLifecycleForWorkbench(
  lifecycle: UsePiSessionStateResult["lifecycle"],
): SessionLifecycleForWorkbench {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput: InitialSessionConnectInput): void => {
      lifecycle.connectSession(toPiConnectSessionInput(connectInput));
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    disconnectSession: lifecycle.disconnectSession,
    isStartingSession: lifecycle.isStartingSession,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    recoverSession: (recoverInput): void => {
      lifecycle.recoverSession({
        sandboxInstanceId: recoverInput.sandboxInstanceId,
        targetConversationId: recoverInput.targetRuntimeConversationId,
      });
    },
    recoverableDisconnect: null,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeRuntimeConversationId: lifecycle.sessionSnapshot.activeConversationId,
            connectedAtIso: lifecycle.sessionSnapshot.connectedAtIso,
            providerConversationId: lifecycle.sessionSnapshot.providerConversationId,
            sandboxInstanceId: lifecycle.sessionSnapshot.sandboxInstanceId,
          },
  };
}

export function resolveSessionLifecycleForWorkbench(input: {
  agentRuntimeId: string | null;
  codexLifecycle: SessionLifecycleForWorkbench;
  openCodeLifecycle: SessionLifecycleForWorkbench;
  piLifecycle: SessionLifecycleForWorkbench;
}): SessionLifecycleForWorkbench {
  if (input.agentRuntimeId === SessionRuntimeWorkbenchCapabilities.OPENCODE.runtimeId) {
    return input.openCodeLifecycle;
  }
  if (input.agentRuntimeId === SessionRuntimeWorkbenchCapabilities.PI.runtimeId) {
    return input.piLifecycle;
  }
  return input.codexLifecycle;
}

export function buildCodexHandoffRuntime(input: {
  chat: UseCodexSessionStateResult["chat"];
  lifecycle: SessionMainPanelHandoffLifecycle;
  serverRequests: UseCodexSessionStateResult["serverRequests"];
  threadAuthority: UseCodexSessionStateResult["threadAuthority"];
}): SessionMainPanelHandoffRuntime {
  return {
    buildCliPtyOpenInput: buildCodexCliPtyOpenInput,
    clearActiveThreadIdAfterCliLaunch: input.threadAuthority.clearActiveThreadIdAfterCliLaunch,
    displayName: SessionRuntimeWorkbenchCapabilities.CODEX.displayName,
    hydrateChatFromConversation: input.chat.hydrateChatFromThread,
    lifecycle: input.lifecycle,
    preserveCliLaunchForRestore:
      SessionRuntimeWorkbenchCapabilities.CODEX.preservesCliLaunchContext,
    resetServerRequests: input.serverRequests.resetServerRequests,
    restoreConversationId: input.threadAuthority.providerThreadId,
    restoreProviderConversationId: input.threadAuthority.providerThreadId,
    resolveCliLaunchTarget: input.threadAuthority.resolveCliLaunchTarget,
  };
}

export function buildOpenCodeHandoffRuntime(input: {
  chat: UseOpenCodeSessionStateResult["chat"];
  lifecycle: SessionMainPanelHandoffLifecycle;
  sessionSnapshot: UseOpenCodeSessionStateResult["lifecycle"]["sessionSnapshot"];
}): SessionMainPanelHandoffRuntime {
  return {
    buildCliPtyOpenInput: buildOpenCodeCliPtyOpenInput,
    clearActiveThreadIdAfterCliLaunch: () => {},
    displayName: SessionRuntimeWorkbenchCapabilities.OPENCODE.displayName,
    hydrateChatFromConversation: input.chat.hydrateChatFromSessionOrThrow,
    lifecycle: input.lifecycle,
    preserveCliLaunchForRestore:
      SessionRuntimeWorkbenchCapabilities.OPENCODE.preservesCliLaunchContext,
    resetServerRequests: () => {},
    restoreConversationId: input.sessionSnapshot?.activeSessionId ?? null,
    restoreProviderConversationId: input.sessionSnapshot?.providerSessionId ?? null,
    resolveCliLaunchTarget: async () => {
      const activeSessionId = input.sessionSnapshot?.activeSessionId ?? null;

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
  };
}

export function buildPiHandoffRuntime(input: {
  chat: UsePiSessionStateResult["chat"];
  handoff: UsePiSessionStateResult["handoff"];
  lifecycle: SessionMainPanelHandoffLifecycle;
  sessionSnapshot: UsePiSessionStateResult["lifecycle"]["sessionSnapshot"];
}): SessionMainPanelHandoffRuntime {
  return {
    buildCliPtyOpenInput: buildPiCliPtyOpenInput,
    clearActiveThreadIdAfterCliLaunch: () => {},
    displayName: SessionRuntimeWorkbenchCapabilities.PI.displayName,
    hydrateChatFromConversation: input.chat.confirmChatRestoredAfterReconnect,
    lifecycle: input.lifecycle,
    preserveCliLaunchForRestore: SessionRuntimeWorkbenchCapabilities.PI.preservesCliLaunchContext,
    resetServerRequests: () => {},
    restoreConversationId: input.sessionSnapshot?.activeConversationId ?? null,
    restoreProviderConversationId: input.sessionSnapshot?.providerConversationId ?? null,
    resolveCliLaunchTarget: input.handoff.resolveCliLaunchTarget,
  };
}
