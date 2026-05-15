import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBestEffortBrowserStorage,
  readBrowserStorageJson,
  writeBrowserStorageJson,
} from "../shared/browser-storage.js";

const DIFF_WORKBENCH_STORAGE_KEY_PREFIX = "dashboard:session-diff-workbench:";

type PersistedDiffWorkbenchState = {
  isVisible: boolean;
};

type SessionDiffWorkbenchState = {
  closePanel: () => void;
  isVisible: boolean;
  openPanel: () => void;
  togglePanel: () => void;
};

type VolatileDiffWorkbenchState = {
  generation: number;
  state: PersistedDiffWorkbenchState;
};

function getDiffWorkbenchStorageKey(sandboxInstanceId: string): string {
  return `${DIFF_WORKBENCH_STORAGE_KEY_PREFIX}${sandboxInstanceId}`;
}

function isPersistedDiffWorkbenchState(value: unknown): value is PersistedDiffWorkbenchState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return typeof Reflect.get(value, "isVisible") === "boolean";
}

function readPersistedDiffWorkbenchState(
  sandboxInstanceId: string | null,
): PersistedDiffWorkbenchState {
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
    key: getDiffWorkbenchStorageKey(sandboxInstanceId),
    storage,
    isValue: isPersistedDiffWorkbenchState,
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

export function useSessionDiffWorkbenchState(input: {
  sandboxInstanceId: string | null;
}): SessionDiffWorkbenchState {
  const storage = getBestEffortBrowserStorage("local");
  const previousSandboxInstanceIdRef = useRef(input.sandboxInstanceId);
  const volatileStateGenerationRef = useRef(0);
  if (previousSandboxInstanceIdRef.current !== input.sandboxInstanceId) {
    previousSandboxInstanceIdRef.current = input.sandboxInstanceId;
    volatileStateGenerationRef.current += 1;
  }

  const [stateBySandboxInstanceId, setStateBySandboxInstanceId] = useState<
    Readonly<Record<string, PersistedDiffWorkbenchState>>
  >({});
  const [volatileState, setVolatileState] = useState<VolatileDiffWorkbenchState>({
    generation: volatileStateGenerationRef.current,
    state: readPersistedDiffWorkbenchState(null),
  });

  const resolvedState =
    input.sandboxInstanceId === null
      ? readPersistedDiffWorkbenchState(null)
      : storage === null
        ? volatileState.generation === volatileStateGenerationRef.current
          ? volatileState.state
          : readPersistedDiffWorkbenchState(null)
        : (stateBySandboxInstanceId[input.sandboxInstanceId] ??
          readPersistedDiffWorkbenchState(input.sandboxInstanceId));

  const updateCurrentState = useCallback(
    (updater: (currentState: PersistedDiffWorkbenchState) => PersistedDiffWorkbenchState): void => {
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
              : readPersistedDiffWorkbenchState(null),
          ),
        }));
        return;
      }

      setStateBySandboxInstanceId((currentState) => {
        const persistedState =
          currentState[sandboxInstanceId] ?? readPersistedDiffWorkbenchState(sandboxInstanceId);

        return {
          ...currentState,
          [sandboxInstanceId]: updater(persistedState),
        };
      });
    },
    [input.sandboxInstanceId, storage],
  );

  useEffect(() => {
    if (input.sandboxInstanceId === null || storage === null) {
      return;
    }

    writeBrowserStorageJson({
      key: getDiffWorkbenchStorageKey(input.sandboxInstanceId),
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

export type { SessionDiffWorkbenchState };
