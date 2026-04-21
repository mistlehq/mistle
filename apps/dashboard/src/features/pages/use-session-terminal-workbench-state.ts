import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBestEffortBrowserStorage,
  readBrowserStorageJson,
  writeBrowserStorageJson,
} from "../shared/browser-storage.js";

const TERMINAL_WORKBENCH_STORAGE_KEY_PREFIX = "dashboard:session-terminal-workbench:";
const MIN_TERMINAL_PANEL_SIZE = 160;

type PersistedTerminalWorkbenchState = {
  isVisible: boolean;
};

type SessionTerminalWorkbenchState = {
  closePanel: () => void;
  isVisible: boolean;
  openPanel: () => void;
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

  return typeof Reflect.get(value, "isVisible") === "boolean";
}

function readPersistedTerminalWorkbenchState(
  sandboxInstanceId: string | null,
): PersistedTerminalWorkbenchState {
  if (sandboxInstanceId === null) {
    return {
      isVisible: false,
    };
  }

  const storage = getBestEffortBrowserStorage("local");
  if (storage === null) {
    return {
      isVisible: false,
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
    };
  }

  return {
    isVisible: storedValue.isVisible,
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
      },
      storage,
    });
  }, [input.sandboxInstanceId, resolvedState, storage]);

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
