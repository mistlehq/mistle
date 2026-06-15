import { useCallback, useMemo, type RefObject } from "react";

import type { UseClaudeCodeSessionStateResult } from "../session-agents/claude-code/session-state/index.js";
import type { UseCodexSessionStateResult } from "../session-agents/codex/session-state/index.js";
import type { UseOpenCodeSessionStateResult } from "../session-agents/opencode/session-state/index.js";
import type { UsePiSessionStateResult } from "../session-agents/pi/session-state/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "../session-agents/session-runtime-workbench-capabilities.js";
import {
  buildCodexHandoffRuntime,
  buildCodexLifecycleForHandoff,
  buildCodexLifecycleForWorkbench,
  buildClaudeCodeHandoffRuntime,
  buildClaudeCodeLifecycleForHandoff,
  buildClaudeCodeLifecycleForWorkbench,
  buildOpenCodeHandoffRuntime,
  buildOpenCodeLifecycleForHandoff,
  buildOpenCodeLifecycleForWorkbench,
  buildPiHandoffRuntime,
  buildPiLifecycleForHandoff,
  buildPiLifecycleForWorkbench,
  resolveSessionLifecycleForWorkbench,
} from "../session-agents/session-workbench-handoff-runtimes.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  useSessionMainPanelHandoff,
  type SessionMainPanelRuntimeId,
} from "./use-session-main-panel-handoff.js";
import type { SessionLifecycleForWorkbench } from "./use-session-workbench-lifecycle-state.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;
const ClaudeCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CLAUDE_CODE;
const OpenCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;
const PiWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.PI;

type SessionWorkbenchHandoffControlState = {
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  handoff: ReturnType<typeof useSessionMainPanelHandoff>;
  resolveLifecycleForWorkbench: (agentRuntimeId: string | null) => SessionLifecycleForWorkbench;
};

export function useSessionWorkbenchHandoffControl(input: {
  activeHandoffRuntimeIdRef: RefObject<SessionMainPanelRuntimeId>;
  claudeCodeSessionState: UseClaudeCodeSessionStateResult;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  openCodeSessionState: UseOpenCodeSessionStateResult;
  piSessionState: UsePiSessionStateResult;
  sandboxInstanceId: string | null;
  selectedRepositoryPathRef: RefObject<string | null>;
  sessionState: UseCodexSessionStateResult;
}): SessionWorkbenchHandoffControlState {
  const lifecycle = input.sessionState.lifecycle;
  const claudeCodeLifecycle = input.claudeCodeSessionState.lifecycle;
  const openCodeLifecycle = input.openCodeSessionState.lifecycle;
  const piLifecycle = input.piSessionState.lifecycle;
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
  const codexLifecycleForWorkbench = useMemo(
    () => buildCodexLifecycleForWorkbench(lifecycle),
    [
      lifecycle.clearLifecycleErrorMessage,
      lifecycle.connectSession,
      lifecycle.detachSessionConnection,
      lifecycle.disconnectSession,
      lifecycle.isStartingSession,
      lifecycle.lifecycleErrorMessage,
      lifecycle.recoverSession,
      lifecycle.recoverableDisconnect,
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
  const claudeCodeLifecycleForHandoff = useMemo(
    () => buildClaudeCodeLifecycleForHandoff(claudeCodeLifecycle),
    [
      claudeCodeLifecycle.clearLifecycleErrorMessage,
      claudeCodeLifecycle.connectSession,
      claudeCodeLifecycle.detachSessionConnection,
      claudeCodeLifecycle.lifecycleErrorMessage,
      claudeCodeLifecycle.sessionConnectionState,
      claudeCodeLifecycle.sessionSnapshot,
    ],
  );
  const claudeCodeLifecycleForWorkbench = useMemo(
    () => buildClaudeCodeLifecycleForWorkbench(claudeCodeLifecycle),
    [
      claudeCodeLifecycle.clearLifecycleErrorMessage,
      claudeCodeLifecycle.connectSession,
      claudeCodeLifecycle.detachSessionConnection,
      claudeCodeLifecycle.disconnectSession,
      claudeCodeLifecycle.isStartingSession,
      claudeCodeLifecycle.lifecycleErrorMessage,
      claudeCodeLifecycle.recoverSession,
      claudeCodeLifecycle.recoverableDisconnect,
      claudeCodeLifecycle.sessionConnectionState,
      claudeCodeLifecycle.sessionSnapshot,
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
  const piLifecycleForHandoff = useMemo(
    () => buildPiLifecycleForHandoff(piLifecycle),
    [
      piLifecycle.clearLifecycleErrorMessage,
      piLifecycle.connectSession,
      piLifecycle.detachSessionConnection,
      piLifecycle.lifecycleErrorMessage,
      piLifecycle.sessionConnectionState,
      piLifecycle.sessionSnapshot,
    ],
  );
  const piLifecycleForWorkbench = useMemo(
    () => buildPiLifecycleForWorkbench(piLifecycle),
    [
      piLifecycle.clearLifecycleErrorMessage,
      piLifecycle.connectSession,
      piLifecycle.detachSessionConnection,
      piLifecycle.disconnectSession,
      piLifecycle.isStartingSession,
      piLifecycle.lifecycleErrorMessage,
      piLifecycle.recoverSession,
      piLifecycle.recoverableDisconnect,
      piLifecycle.sessionConnectionState,
      piLifecycle.sessionSnapshot,
    ],
  );
  const resolveLifecycleForWorkbench = useCallback(
    (agentRuntimeId: string | null) =>
      resolveSessionLifecycleForWorkbench({
        agentRuntimeId,
        claudeCodeLifecycle: claudeCodeLifecycleForWorkbench,
        codexLifecycle: codexLifecycleForWorkbench,
        openCodeLifecycle: openCodeLifecycleForWorkbench,
        piLifecycle: piLifecycleForWorkbench,
      }),
    [
      claudeCodeLifecycleForWorkbench,
      codexLifecycleForWorkbench,
      openCodeLifecycleForWorkbench,
      piLifecycleForWorkbench,
    ],
  );
  const cliPtyState = useSandboxPtyState({
    ensureTransportConnected: input.ensureTransportConnected,
  });
  const codexHandoffRuntime = useMemo(
    () =>
      buildCodexHandoffRuntime({
        chat: input.sessionState.chat,
        lifecycle: codexLifecycleForHandoff,
        serverRequests: input.sessionState.serverRequests,
        threadAuthority: input.sessionState.threadAuthority,
      }),
    [
      input.sessionState.chat.hydrateChatFromThread,
      codexLifecycleForHandoff,
      input.sessionState.serverRequests.resetServerRequests,
      input.sessionState.threadAuthority.clearActiveThreadIdAfterCliLaunch,
      input.sessionState.threadAuthority.providerThreadId,
      input.sessionState.threadAuthority.resolveCliLaunchTarget,
    ],
  );
  const openCodeHandoffRuntime = useMemo(
    () =>
      buildOpenCodeHandoffRuntime({
        chat: input.openCodeSessionState.chat,
        lifecycle: openCodeLifecycleForHandoff,
        sessionSnapshot: input.openCodeSessionState.lifecycle.sessionSnapshot,
      }),
    [
      openCodeLifecycleForHandoff,
      input.openCodeSessionState.chat.hydrateChatFromSessionOrThrow,
      input.openCodeSessionState.lifecycle.sessionSnapshot,
    ],
  );
  const claudeCodeHandoffRuntime = useMemo(
    () =>
      buildClaudeCodeHandoffRuntime({
        chat: input.claudeCodeSessionState.chat,
        lifecycle: claudeCodeLifecycleForHandoff,
        sessionSnapshot: input.claudeCodeSessionState.lifecycle.sessionSnapshot,
      }),
    [
      claudeCodeLifecycleForHandoff,
      input.claudeCodeSessionState.chat.hydrateChatFromThreadOrThrow,
      input.claudeCodeSessionState.lifecycle.sessionSnapshot,
    ],
  );
  const piHandoffRuntime = useMemo(
    () =>
      buildPiHandoffRuntime({
        chat: input.piSessionState.chat,
        handoff: input.piSessionState.handoff,
        lifecycle: piLifecycleForHandoff,
        sessionSnapshot: input.piSessionState.lifecycle.sessionSnapshot,
      }),
    [
      input.piSessionState.chat.confirmChatRestoredAfterReconnect,
      input.piSessionState.handoff,
      input.piSessionState.lifecycle.sessionSnapshot,
      piLifecycleForHandoff,
    ],
  );
  const handoffRuntimes = useMemo(
    () => ({
      [ClaudeCodeWorkbenchCapabilities.runtimeId]: claudeCodeHandoffRuntime,
      [CodexWorkbenchCapabilities.runtimeId]: codexHandoffRuntime,
      [OpenCodeWorkbenchCapabilities.runtimeId]: openCodeHandoffRuntime,
      [PiWorkbenchCapabilities.runtimeId]: piHandoffRuntime,
    }),
    [claudeCodeHandoffRuntime, codexHandoffRuntime, openCodeHandoffRuntime, piHandoffRuntime],
  );
  const handoff = useSessionMainPanelHandoff({
    activeRuntimeIdRef: input.activeHandoffRuntimeIdRef,
    cliPtyState,
    runtimes: handoffRuntimes,
    selectedRepositoryPathRef: input.selectedRepositoryPathRef,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  return {
    cliPtyState,
    handoff,
    resolveLifecycleForWorkbench,
  };
}
