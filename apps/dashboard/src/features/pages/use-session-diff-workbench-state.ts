import { useCallback, useEffect, useState } from "react";

type SessionDiffWorkbenchState = {
  closePanel: () => void;
  isVisible: boolean;
  openPanel: () => void;
  togglePanel: () => void;
};

export function useSessionDiffWorkbenchState(input: {
  sandboxInstanceId: string | null;
}): SessionDiffWorkbenchState {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(false);
  }, [input.sandboxInstanceId]);

  const openPanel = useCallback((): void => {
    setIsVisible(true);
  }, []);

  const closePanel = useCallback((): void => {
    setIsVisible(false);
  }, []);

  const togglePanel = useCallback((): void => {
    setIsVisible((currentState) => !currentState);
  }, []);

  return {
    closePanel,
    isVisible,
    openPanel,
    togglePanel,
  };
}
