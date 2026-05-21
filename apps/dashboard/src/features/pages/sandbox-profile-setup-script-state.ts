import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { sandboxProfileVersionSetupScriptQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfileVersionSetupScript } from "../sandbox-profiles/sandbox-profiles-service.js";
import { getErrorMessage } from "../shared/auto-save-behavior.js";

export function useSandboxProfileSetupScriptLoader(input: {
  profileId: string;
  refetchIntervalMs?: false | number;
  version: number;
}): {
  setupScriptQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  setupScript: string | null;
} {
  const setupScriptQuery = useQuery({
    queryKey: sandboxProfileVersionSetupScriptQueryKey({
      profileId: input.profileId,
      version: input.version,
    }),
    queryFn: async ({ signal }) =>
      getSandboxProfileVersionSetupScript({
        profileId: input.profileId,
        version: input.version,
        signal,
      }),
    refetchInterval: input.refetchIntervalMs ?? false,
    retry: false,
  });

  return {
    setupScriptQuery: {
      isError: setupScriptQuery.isError,
      error: setupScriptQuery.error,
      isPending: setupScriptQuery.isPending,
    },
    setupScript: setupScriptQuery.data?.setupScript ?? null,
  };
}

export function useLoadedSandboxProfileSetupScriptState(input: {
  profileId: string;
  version: number;
  setupScript: string | null;
}): {
  draftValue: string;
  errorMessage: string | null;
  hasUnsavedChanges: boolean;
  savedValue: string;
  applyDraftSaveError: (error: unknown) => void;
  applyPendingExternalUpdate: () => void;
  applySavedSetupScript: (setupScript: string | null) => void;
  buildDraftChanges: () => string | null;
  dismissPendingExternalUpdate: () => void;
  pendingExternalUpdate: boolean;
  onChange: (nextValue: string) => void;
} {
  const [draftValue, setDraftValue] = useState(input.setupScript ?? "");
  const [persistedValue, setPersistedValue] = useState(input.setupScript ?? "");
  const [pendingExternalValue, setPendingExternalValue] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previousSetupScriptRef = useRef(input.setupScript);
  const draftValueRef = useRef(draftValue);
  const persistedValueRef = useRef(persistedValue);
  draftValueRef.current = draftValue;
  persistedValueRef.current = persistedValue;

  useEffect(() => {
    const previousSetupScript = previousSetupScriptRef.current;
    previousSetupScriptRef.current = input.setupScript;

    if (input.setupScript === previousSetupScript) {
      return;
    }

    const nextValue = input.setupScript ?? "";
    setPersistedValue(nextValue);
    setErrorMessage(null);

    if (
      draftValueRef.current === persistedValueRef.current ||
      draftValueRef.current === nextValue
    ) {
      setDraftValue(nextValue);
      setPendingExternalValue(null);
      return;
    }

    setPendingExternalValue(nextValue);
  }, [input.setupScript]);

  function clearFeedback(): void {
    if (errorMessage === null) {
      return;
    }

    setErrorMessage(null);
  }

  function onChange(nextValue: string): void {
    setDraftValue(nextValue);
    setPendingExternalValue((currentValue) => (currentValue === nextValue ? null : currentValue));
    clearFeedback();
  }

  const buildDraftChanges = useCallback((): string | null => {
    clearFeedback();
    return draftValueRef.current.length === 0 ? null : draftValueRef.current;
  }, [errorMessage]);

  const applySavedSetupScript = useCallback((setupScript: string | null): void => {
    setDraftValue(setupScript ?? "");
    setPersistedValue(setupScript ?? "");
    setPendingExternalValue(null);
    setErrorMessage(null);
  }, []);

  const applyPendingExternalUpdate = useCallback((): void => {
    if (pendingExternalValue === null) {
      return;
    }

    setDraftValue(pendingExternalValue);
    setPersistedValue(pendingExternalValue);
    setPendingExternalValue(null);
    setErrorMessage(null);
  }, [pendingExternalValue]);

  const dismissPendingExternalUpdate = useCallback((): void => {
    setPendingExternalValue(null);
  }, []);

  const applyDraftSaveError = useCallback((error: unknown): void => {
    setErrorMessage(getErrorMessage(error));
  }, []);

  return {
    draftValue,
    errorMessage,
    hasUnsavedChanges: draftValue !== persistedValue,
    pendingExternalUpdate: pendingExternalValue !== null,
    savedValue: persistedValue,
    applyDraftSaveError,
    applyPendingExternalUpdate,
    applySavedSetupScript,
    buildDraftChanges,
    dismissPendingExternalUpdate,
    onChange,
  };
}
