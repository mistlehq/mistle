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

export function buildCodexLifecycleForHandoff(
  lifecycle: UseCodexSessionStateResult["lifecycle"],
): SessionMainPanelHandoffLifecycle {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput): void => {
      if (connectInput.targetThreadId === null) {
        lifecycle.connectSession({
          ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
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
  };
}

export function buildOpenCodeLifecycleForHandoff(
  lifecycle: UseOpenCodeSessionStateResult["lifecycle"],
): SessionMainPanelHandoffLifecycle {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput): void => {
      lifecycle.connectSession({
        ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
        sandboxInstanceId: connectInput.sandboxInstanceId,
        ...(connectInput.targetThreadId === null
          ? {}
          : { targetSessionId: connectInput.targetThreadId }),
      });
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
      if (connectInput.targetThreadId === null) {
        lifecycle.connectSession({
          ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
          sandboxInstanceId: connectInput.sandboxInstanceId,
        });
        return;
      }

      lifecycle.connectSession({
        sandboxInstanceId: connectInput.sandboxInstanceId,
        targetThreadId: connectInput.targetThreadId,
      });
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    disconnectSession: lifecycle.disconnectSession,
    isStartingSession: lifecycle.isStartingSession,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    recoverSession: lifecycle.recoverSession,
    recoverableDisconnect: lifecycle.recoverableDisconnect,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeThreadId: lifecycle.sessionSnapshot.activeSessionId,
            connectedAtIso: lifecycle.sessionSnapshot.connectedAtIso,
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
      lifecycle.connectSession({
        ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
        sandboxInstanceId: connectInput.sandboxInstanceId,
        ...(connectInput.targetThreadId === null
          ? {}
          : { targetSessionFile: connectInput.targetThreadId }),
      });
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeConversationId: lifecycle.sessionSnapshot.activeSessionFile,
          },
  };
}

export function buildPiLifecycleForWorkbench(
  lifecycle: UsePiSessionStateResult["lifecycle"],
): SessionLifecycleForWorkbench {
  return {
    clearLifecycleErrorMessage: lifecycle.clearLifecycleErrorMessage,
    connectSession: (connectInput: InitialSessionConnectInput): void => {
      lifecycle.connectSession({
        ...(connectInput.initialCwd === undefined ? {} : { initialCwd: connectInput.initialCwd }),
        sandboxInstanceId: connectInput.sandboxInstanceId,
        ...(connectInput.targetThreadId === null
          ? {}
          : { targetThreadId: connectInput.targetThreadId }),
      });
    },
    detachSessionConnection: lifecycle.detachSessionConnection,
    disconnectSession: lifecycle.disconnectSession,
    isStartingSession: lifecycle.isStartingSession,
    lifecycleErrorMessage: lifecycle.lifecycleErrorMessage,
    recoverSession: lifecycle.recoverSession,
    recoverableDisconnect: lifecycle.recoverableDisconnect,
    sessionConnectionState: lifecycle.sessionConnectionState,
    sessionSnapshot:
      lifecycle.sessionSnapshot === null
        ? null
        : {
            activeThreadId: lifecycle.sessionSnapshot.activeSessionFile,
            connectedAtIso: lifecycle.sessionSnapshot.connectedAtIso,
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
    restoreConversationId: input.sessionSnapshot?.activeSessionFile ?? null,
    resolveCliLaunchTarget: async () => {
      const activeSessionFile = input.sessionSnapshot?.activeSessionFile ?? null;

      if (activeSessionFile === null) {
        return {
          type: "start_new",
          shouldClearActiveThreadId: false,
        };
      }

      return {
        type: "resume",
        threadId: activeSessionFile,
      };
    },
  };
}
