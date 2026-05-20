import { useCallback, type RefObject } from "react";

import { SessionRuntimeWorkbenchCapabilities } from "../session-agents/session-runtime-workbench-capabilities.js";
import {
  resolveInitialSelectedRepositoryPath,
  resolveSessionTerminalCwd,
} from "./session-primary-repository-policy.js";
import type { SessionMainPanelRuntimeId } from "./use-session-main-panel-handoff.js";
import {
  useSessionPrimaryRepositoryState,
  type SessionPrimaryRepositoryState,
} from "./use-session-primary-repository-state.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;
const OpenCodeWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;
const PiWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.PI;

type SessionWorkbenchRepositoryControlState = {
  isOpenCodeRuntime: boolean;
  isPiRuntime: boolean;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  primaryRepositoryState: SessionPrimaryRepositoryState;
  selectedRepositoryPath: string | null;
  terminalCwd: string;
};

export function useSessionWorkbenchRepositoryControl(input: {
  activeHandoffRuntimeIdRef: RefObject<SessionMainPanelRuntimeId>;
  canConnect: boolean;
  codexActiveThreadCwd: string | null | undefined;
  ensureCanSwitchPrimaryRepository: () => Promise<void>;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  isCliToggleActive: boolean;
  runtimeAgentRuntimeId: string | null | undefined;
  runtimePrimaryRepositoryRoot: string | null | undefined;
  sandboxInstanceId: string | null;
  selectedRepositoryPathRef: RefObject<string | null>;
}): SessionWorkbenchRepositoryControlState {
  const isOpenCodeRuntime = input.runtimeAgentRuntimeId === OpenCodeWorkbenchCapabilities.runtimeId;
  const isPiRuntime = input.runtimeAgentRuntimeId === PiWorkbenchCapabilities.runtimeId;
  const activeRuntimeCapabilities = isOpenCodeRuntime
    ? OpenCodeWorkbenchCapabilities
    : isPiRuntime
      ? PiWorkbenchCapabilities
      : CodexWorkbenchCapabilities;
  input.activeHandoffRuntimeIdRef.current = activeRuntimeCapabilities.runtimeId;

  const activeThreadCwd = isOpenCodeRuntime || isPiRuntime ? null : input.codexActiveThreadCwd;
  const initialSelectedRepositoryPath = resolveInitialSelectedRepositoryPath({
    activeThreadCwd: activeThreadCwd ?? undefined,
    runtimePrimaryRepositoryRoot: input.runtimePrimaryRepositoryRoot,
  });
  const primaryRepositoryState = useSessionPrimaryRepositoryState({
    enabled: input.canConnect,
    ensureTransportConnected: input.ensureTransportConnected,
    initialSelectedRepositoryPath,
    runtimeDisplayName: activeRuntimeCapabilities.displayName,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const selectedRepositoryPath = primaryRepositoryState.selectedRepositoryPath;
  input.selectedRepositoryPathRef.current = selectedRepositoryPath;
  const terminalCwd = resolveSessionTerminalCwd({
    activeThreadCwd,
    selectedRepositoryPath,
  });
  const isPrimaryRepositorySwitchBlockedByCli = input.isCliToggleActive;
  const switchPrimaryRepository = useCallback(
    async (nextSelectedRepositoryPath: string | null): Promise<void> => {
      if (nextSelectedRepositoryPath === selectedRepositoryPath) {
        return;
      }

      if (!isOpenCodeRuntime && !isPiRuntime) {
        await input.ensureCanSwitchPrimaryRepository();
      }
      primaryRepositoryState.setSelectedRepositoryPath(nextSelectedRepositoryPath);
    },
    [
      input.ensureCanSwitchPrimaryRepository,
      isOpenCodeRuntime,
      isPiRuntime,
      primaryRepositoryState.setSelectedRepositoryPath,
      selectedRepositoryPath,
    ],
  );

  return {
    isOpenCodeRuntime,
    isPiRuntime,
    primaryRepositoryControlState: {
      disabledReason:
        !isOpenCodeRuntime && !isPiRuntime && isPrimaryRepositorySwitchBlockedByCli
          ? "Exit Codex TUI before switching the primary repository."
          : null,
      switchPrimaryRepository,
    },
    primaryRepositoryState,
    selectedRepositoryPath,
    terminalCwd,
  };
}
