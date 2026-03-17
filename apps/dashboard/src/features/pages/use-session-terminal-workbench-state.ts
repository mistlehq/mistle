import { useCallback, useEffect, useState } from "react";

const DEFAULT_TERMINAL_PANEL_SIZE = 38;
const TERMINAL_WORKBENCH_STORAGE_KEY_PREFIX = "dashboard:session-terminal-workbench:";

type PersistedTerminalWorkbenchState = {
  isVisible: boolean;
  panelSize: number;
};

type SessionTerminalWorkbenchState = {
  closePanel: () => void;
  isVisible: boolean;
  openPanel: () => void;
  panelSize: number;
  setPanelSize: (size: number) => void;
  togglePanel: () => void;
};

function getTerminalWorkbenchStorageKey(sandboxInstanceId: string): string {
  return `${TERMINAL_WORKBENCH_STORAGE_KEY_PREFIX}${sandboxInstanceId}`;
}

function isPersistedTerminalWorkbenchState(
  value: unknown,
): value is PersistedTerminalWorkbenchState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const isVisible = Reflect.get(value, "isVisible");
  const panelSize = Reflect.get(value, "panelSize");

  return typeof isVisible === "boolean" && typeof panelSize === "number";
}

function normalizePanelSize(size: number): number {
  return Math.min(75, Math.max(20, size));
}

function getBrowserStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = window.localStorage;
  if (
    typeof storage !== "object" ||
    storage === null ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return null;
  }

  return storage;
}

function readPersistedTerminalWorkbenchState(
  sandboxInstanceId: string | null,
): PersistedTerminalWorkbenchState {
  if (sandboxInstanceId === null) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  const storage = getBrowserStorage();
  if (storage === null) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  const storedValue = storage.getItem(getTerminalWorkbenchStorageKey(sandboxInstanceId));
  if (storedValue === null) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  if (!isPersistedTerminalWorkbenchState(parsedValue)) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  return {
    isVisible: parsedValue.isVisible,
    panelSize: normalizePanelSize(parsedValue.panelSize),
  };
}

export function useSessionTerminalWorkbenchState(input: {
  sandboxInstanceId: string | null;
}): SessionTerminalWorkbenchState {
  const [state, setState] = useState<PersistedTerminalWorkbenchState>(() =>
    readPersistedTerminalWorkbenchState(input.sandboxInstanceId),
  );

  useEffect(() => {
    setState(readPersistedTerminalWorkbenchState(input.sandboxInstanceId));
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.sandboxInstanceId === null) {
      return;
    }

    const storage = getBrowserStorage();
    if (storage === null) {
      return;
    }

    storage.setItem(getTerminalWorkbenchStorageKey(input.sandboxInstanceId), JSON.stringify(state));
  }, [input.sandboxInstanceId, state]);

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

export { DEFAULT_TERMINAL_PANEL_SIZE };
