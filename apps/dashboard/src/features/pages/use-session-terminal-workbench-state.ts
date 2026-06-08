import { useCallback, useRef, useState } from "react";

const MIN_TERMINAL_PANEL_SIZE = 160;

type TerminalWorkbenchPanelState = {
  isVisible: boolean;
};

type SessionTerminalWorkbenchState = {
  closePanel: () => void;
  isVisible: boolean;
  openPanel: () => void;
  togglePanel: () => void;
};

function createClosedTerminalWorkbenchState(): TerminalWorkbenchPanelState {
  return {
    isVisible: false,
  };
}

export function useSessionTerminalWorkbenchState(input: {
  sandboxInstanceId: string | null;
}): SessionTerminalWorkbenchState {
  const previousSandboxInstanceIdRef = useRef(input.sandboxInstanceId);
  const currentStateRef = useRef<TerminalWorkbenchPanelState>(createClosedTerminalWorkbenchState());
  const [, setRevision] = useState(0);

  if (previousSandboxInstanceIdRef.current !== input.sandboxInstanceId) {
    previousSandboxInstanceIdRef.current = input.sandboxInstanceId;
    currentStateRef.current = createClosedTerminalWorkbenchState();
  }

  const resolvedState =
    input.sandboxInstanceId === null
      ? createClosedTerminalWorkbenchState()
      : currentStateRef.current;

  const updateCurrentState = useCallback(
    (updater: (currentState: TerminalWorkbenchPanelState) => TerminalWorkbenchPanelState): void => {
      if (input.sandboxInstanceId === null) {
        return;
      }

      currentStateRef.current = updater(currentStateRef.current);
      setRevision((currentRevision) => currentRevision + 1);
    },
    [input.sandboxInstanceId],
  );

  const openPanel = useCallback((): void => {
    updateCurrentState((currentState) => ({
      ...currentState,
      isVisible: true,
    }));
  }, [updateCurrentState]);

  const closePanel = useCallback((): void => {
    updateCurrentState((currentState) => ({
      ...currentState,
      isVisible: false,
    }));
  }, [updateCurrentState]);

  const togglePanel = useCallback((): void => {
    updateCurrentState((currentState) => ({
      ...currentState,
      isVisible: !currentState.isVisible,
    }));
  }, [updateCurrentState]);

  return {
    closePanel,
    isVisible: resolvedState.isVisible,
    openPanel,
    togglePanel,
  };
}

export { MIN_TERMINAL_PANEL_SIZE };
export type { SessionTerminalWorkbenchState };
