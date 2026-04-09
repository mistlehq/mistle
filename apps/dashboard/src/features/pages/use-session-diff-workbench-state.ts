import { useCallback, useEffect, useState } from "react";

const DEFAULT_DIFF_PANEL_SIZE = 42;

type SessionDiffWorkbenchState = {
  closePanel: () => void;
  isVisible: boolean;
  openPanel: () => void;
  panelSize: number;
  setPanelSize: (size: number) => void;
  togglePanel: () => void;
};

function normalizePanelSize(size: number): number {
  return Math.min(75, Math.max(20, size));
}

export function useSessionDiffWorkbenchState(input: {
  sandboxInstanceId: string | null;
}): SessionDiffWorkbenchState {
  const [state, setState] = useState({
    isVisible: false,
    panelSize: DEFAULT_DIFF_PANEL_SIZE,
  });

  useEffect(() => {
    setState({
      isVisible: false,
      panelSize: DEFAULT_DIFF_PANEL_SIZE,
    });
  }, [input.sandboxInstanceId]);

  const openPanel = useCallback((): void => {
    setState((currentState) => ({
      ...currentState,
      isVisible: true,
    }));
  }, []);

  const closePanel = useCallback((): void => {
    setState((currentState) => ({
      ...currentState,
      isVisible: false,
    }));
  }, []);

  const togglePanel = useCallback((): void => {
    setState((currentState) => ({
      ...currentState,
      isVisible: !currentState.isVisible,
    }));
  }, []);

  const setPanelSize = useCallback((size: number): void => {
    setState((currentState) => ({
      ...currentState,
      panelSize: normalizePanelSize(size),
    }));
  }, []);

  return {
    closePanel,
    isVisible: state.isVisible,
    openPanel,
    panelSize: state.panelSize,
    setPanelSize,
    togglePanel,
  };
}

export { DEFAULT_DIFF_PANEL_SIZE };
