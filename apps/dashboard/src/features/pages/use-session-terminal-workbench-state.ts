import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBestEffortBrowserStorage,
  readBrowserStorageJson,
  writeBrowserStorageJson,
} from "../shared/browser-storage.js";

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

type VolatileTerminalWorkbenchState = {
  generation: number;
  state: PersistedTerminalWorkbenchState;
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

function readPersistedTerminalWorkbenchState(
  sandboxInstanceId: string | null,
): PersistedTerminalWorkbenchState {
  if (sandboxInstanceId === null) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  const storage = getBestEffortBrowserStorage("local");
  if (storage === null) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  const storedValue = readBrowserStorageJson({
    key: getTerminalWorkbenchStorageKey(sandboxInstanceId),
    storage,
    isValue: isPersistedTerminalWorkbenchState,
  });
  if (storedValue === null) {
    return {
      isVisible: false,
      panelSize: DEFAULT_TERMINAL_PANEL_SIZE,
    };
  }

  return {
    isVisible: storedValue.isVisible,
    panelSize: normalizePanelSize(storedValue.panelSize),
  };
}

export function useSessionTerminalWorkbenchState(input: {
  sandboxInstanceId: string | null;
}): SessionTerminalWorkbenchState {
  const storage = getBestEffortBrowserStorage("local");
  const previousSandboxInstanceIdRef = useRef(input.sandboxInstanceId);
  const volatileStateGenerationRef = useRef(0);
  if (previousSandboxInstanceIdRef.current !== input.sandboxInstanceId) {
    previousSandboxInstanceIdRef.current = input.sandboxInstanceId;
    volatileStateGenerationRef.current += 1;
  }
  const [stateBySandboxInstanceId, setStateBySandboxInstanceId] = useState<
    Readonly<Record<string, PersistedTerminalWorkbenchState>>
  >({});
  const [volatileState, setVolatileState] = useState<VolatileTerminalWorkbenchState>({
    generation: volatileStateGenerationRef.current,
    state: readPersistedTerminalWorkbenchState(null),
  });
  const resolvedState =
    input.sandboxInstanceId === null
      ? readPersistedTerminalWorkbenchState(null)
      : storage === null
        ? volatileState.generation === volatileStateGenerationRef.current
          ? volatileState.state
          : readPersistedTerminalWorkbenchState(null)
        : (stateBySandboxInstanceId[input.sandboxInstanceId] ??
          readPersistedTerminalWorkbenchState(input.sandboxInstanceId));

  const updateCurrentState = useCallback(
    (
      updater: (currentState: PersistedTerminalWorkbenchState) => PersistedTerminalWorkbenchState,
    ): void => {
      if (input.sandboxInstanceId === null) {
        return;
      }
      const sandboxInstanceId = input.sandboxInstanceId;

      if (storage === null) {
        setVolatileState((currentState) => ({
          generation: volatileStateGenerationRef.current,
          state: updater(
            currentState.generation === volatileStateGenerationRef.current
              ? currentState.state
              : readPersistedTerminalWorkbenchState(null),
          ),
        }));
        return;
      }

      setStateBySandboxInstanceId((currentState) => {
        const persistedState =
          currentState[sandboxInstanceId] ?? readPersistedTerminalWorkbenchState(sandboxInstanceId);

        return {
          ...currentState,
          [sandboxInstanceId]: updater(persistedState),
        };
      });
    },
    [input.sandboxInstanceId, storage, volatileStateGenerationRef],
  );

  useEffect(() => {
    if (input.sandboxInstanceId === null) {
      return;
    }

    if (storage === null) {
      return;
    }

    writeBrowserStorageJson({
      key: getTerminalWorkbenchStorageKey(input.sandboxInstanceId),
      value: {
        isVisible: resolvedState.isVisible,
        panelSize: resolvedState.panelSize,
      },
      storage,
    });
  }, [input.sandboxInstanceId, resolvedState]);

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

  const setPanelSize = useCallback(
    (size: number): void => {
      updateCurrentState((currentState) => ({
        ...currentState,
        panelSize: normalizePanelSize(size),
      }));
    },
    [updateCurrentState],
  );

  return {
    closePanel,
    isVisible: resolvedState.isVisible,
    openPanel,
    panelSize: resolvedState.panelSize,
    setPanelSize,
    togglePanel,
  };
}

export { DEFAULT_TERMINAL_PANEL_SIZE };
