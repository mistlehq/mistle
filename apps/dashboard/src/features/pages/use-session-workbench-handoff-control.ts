import { useCallback, useMemo, type RefObject } from "react";

import type { UseCodexSessionStateResult } from "../session-agents/codex/session-state/index.js";
import type { UseOpenCodeSessionStateResult } from "../session-agents/opencode/session-state/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "../session-agents/session-runtime-workbench-capabilities.js";
import {
  buildCodexHandoffRuntime,
  buildCodexLifecycleForHandoff,
  buildOpenCodeHandoffRuntime,
  buildOpenCodeLifecycleForHandoff,
  buildOpenCodeLifecycleForWorkbench,
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
const OpenCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;

type SessionWorkbenchHandoffControlState = {
  cliPtyState: ReturnType<typeof useSandboxPtyState>;
  handoff: ReturnType<typeof useSessionMainPanelHandoff>;
  resolveLifecycleForWorkbench: (agentRuntimeId: string | null) => SessionLifecycleForWorkbench;
};

export function useSessionWorkbenchHandoffControl(input: {
  activeHandoffRuntimeIdRef: RefObject<SessionMainPanelRuntimeId>;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  openCodeSessionState: UseOpenCodeSessionStateResult;
  sandboxInstanceId: string | null;
  selectedRepositoryPathRef: RefObject<string | null>;
  sessionState: UseCodexSessionStateResult;
}): SessionWorkbenchHandoffControlState {
  const lifecycle = input.sessionState.lifecycle;
  const openCodeLifecycle = input.openCodeSessionState.lifecycle;
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
  const handoffRuntimes = useMemo(
    () => ({
      [CodexWorkbenchCapabilities.runtimeId]: codexHandoffRuntime,
      [OpenCodeWorkbenchCapabilities.runtimeId]: openCodeHandoffRuntime,
    }),
    [codexHandoffRuntime, openCodeHandoffRuntime],
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
