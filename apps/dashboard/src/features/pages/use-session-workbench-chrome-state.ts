import { useSessionBranchDiff, type SessionBranchDiffState } from "./use-session-branch-diff.js";
import {
  useSessionDiffWorkbenchState,
  type SessionDiffWorkbenchState,
} from "./use-session-diff-workbench-state.js";
import { useSessionPortAccess, type SessionPortAccessState } from "./use-session-port-access.js";
import {
  useSessionRepositoryStatus,
  type SessionRepositoryStatus,
} from "./use-session-repository-status.js";
import {
  useSessionTerminalWorkbenchState,
  type SessionTerminalWorkbenchState,
} from "./use-session-terminal-workbench-state.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

type SessionWorkbenchChromeState = {
  diffPanelState: SessionDiffWorkbenchState & SessionBranchDiffState;
  portAccessState: SessionPortAccessState;
  repositoryStatus: SessionRepositoryStatus;
  terminalPanelState: SessionTerminalWorkbenchState;
};

export function useSessionWorkbenchChromeState(input: {
  canConnect: boolean;
  connectedAtIso: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  repositoryStatusRefreshEpoch: number;
  sandboxInstanceId: string | null;
  selectedRepositoryPath: string | null;
  stoppedSessionMessage: string | null;
}): SessionWorkbenchChromeState {
  const terminalPanelState = useSessionTerminalWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const diffWorkbenchState = useSessionDiffWorkbenchState({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const branchDiffState = useSessionBranchDiff({
    cwd: input.selectedRepositoryPath,
    enabled: diffWorkbenchState.isVisible && input.canConnect,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const repositoryStatus = useSessionRepositoryStatus({
    connectedAtIso: input.connectedAtIso,
    cwd: input.selectedRepositoryPath,
    enabled: input.canConnect,
    ensureTransportConnected: input.ensureTransportConnected,
    refreshEpoch: input.repositoryStatusRefreshEpoch,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const portAccessState = useSessionPortAccess({
    canConnect: input.canConnect,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
    stoppedSessionMessage: input.stoppedSessionMessage,
  });

  return {
    diffPanelState: {
      closePanel: diffWorkbenchState.closePanel,
      compareLabel: branchDiffState.compareLabel,
      errorNotice: branchDiffState.errorNotice,
      isLoading: branchDiffState.isLoading,
      isVisible: diffWorkbenchState.isVisible,
      openPanel: diffWorkbenchState.openPanel,
      patch: branchDiffState.patch,
      togglePanel: diffWorkbenchState.togglePanel,
    },
    portAccessState,
    repositoryStatus,
    terminalPanelState,
  };
}

export type { SessionWorkbenchChromeState };
