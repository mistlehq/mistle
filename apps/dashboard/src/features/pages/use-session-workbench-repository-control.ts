import type { AgentRuntimeId } from "@mistle/integrations-definitions/agent-runtimes/catalog";
import { useCallback, type RefObject } from "react";

import {
  getSessionRuntimeWorkbenchCapabilities,
  resolveSessionWorkbenchRuntimeId,
  SessionRuntimeWorkbenchCapabilities,
} from "../session-agents/session-runtime-workbench-capabilities.js";
import {
  resolveInitialSelectedRepositoryPath,
  resolveSessionTerminalCwd,
} from "./session-primary-repository-policy.js";
import {
  useSessionPrimaryRepositoryState,
  type SessionPrimaryRepositoryState,
} from "./use-session-primary-repository-state.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const CodexWorkbenchCapabilities = SessionRuntimeWorkbenchCapabilities.CODEX;

type SessionWorkbenchRepositoryControlState = {
  activeRuntimeId: AgentRuntimeId;
  primaryRepositoryControlState: {
    disabledReason: string | null;
    switchPrimaryRepository: (nextSelectedRepositoryPath: string | null) => Promise<void>;
  };
  primaryRepositoryState: SessionPrimaryRepositoryState;
  selectedRepositoryPath: string | null;
  terminalCwd: string;
};

export function useSessionWorkbenchRepositoryControl(input: {
  activeHandoffRuntimeIdRef: RefObject<AgentRuntimeId>;
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
  const activeRuntimeId = resolveSessionWorkbenchRuntimeId({
    runtimeAgentRuntimeId: input.runtimeAgentRuntimeId,
  });
  const activeRuntimeCapabilities = getSessionRuntimeWorkbenchCapabilities({
    runtimeId: activeRuntimeId,
  });
  input.activeHandoffRuntimeIdRef.current = activeRuntimeCapabilities.runtimeId;

  const activeThreadCwd =
    activeRuntimeId === CodexWorkbenchCapabilities.runtimeId ? input.codexActiveThreadCwd : null;
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

      if (activeRuntimeId === CodexWorkbenchCapabilities.runtimeId) {
        await input.ensureCanSwitchPrimaryRepository();
      }
      primaryRepositoryState.setSelectedRepositoryPath(nextSelectedRepositoryPath);
    },
    [
      activeRuntimeId,
      input.ensureCanSwitchPrimaryRepository,
      primaryRepositoryState.setSelectedRepositoryPath,
      selectedRepositoryPath,
    ],
  );

  return {
    activeRuntimeId,
    primaryRepositoryControlState: {
      disabledReason:
        activeRuntimeId === CodexWorkbenchCapabilities.runtimeId &&
        isPrimaryRepositorySwitchBlockedByCli
          ? "Exit Codex TUI before switching the primary repository."
          : null,
      switchPrimaryRepository,
    },
    primaryRepositoryState,
    selectedRepositoryPath,
    terminalCwd,
  };
}
