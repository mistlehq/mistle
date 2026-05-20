import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { sandboxProfileVersionSetupScriptQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfileVersionSetupScript } from "../sandbox-profiles/sandbox-profiles-service.js";
import { getErrorMessage } from "../shared/auto-save-behavior.js";

export function useSandboxProfileSetupScriptLoader(input: { profileId: string; version: number }): {
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
  applySavedSetupScript: (setupScript: string | null) => void;
  buildDraftChanges: () => string | null;
  onChange: (nextValue: string) => void;
} {
  const [draftValue, setDraftValue] = useState(input.setupScript ?? "");
  const [persistedValue, setPersistedValue] = useState(input.setupScript ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previousSetupScriptRef = useRef(input.setupScript);
  const draftValueRef = useRef(draftValue);
  draftValueRef.current = draftValue;

  useEffect(() => {
    const previousSetupScript = previousSetupScriptRef.current;
    previousSetupScriptRef.current = input.setupScript;

    if (input.setupScript === previousSetupScript) {
      return;
    }

    setDraftValue(input.setupScript ?? "");
    setPersistedValue(input.setupScript ?? "");
    setErrorMessage(null);
  }, [input.setupScript]);

  function clearFeedback(): void {
    if (errorMessage === null) {
      return;
    }

    setErrorMessage(null);
  }

  function onChange(nextValue: string): void {
    setDraftValue(nextValue);
    clearFeedback();
  }

  const buildDraftChanges = useCallback((): string | null => {
    clearFeedback();
    return draftValueRef.current.length === 0 ? null : draftValueRef.current;
  }, [errorMessage]);

  const applySavedSetupScript = useCallback((setupScript: string | null): void => {
    setDraftValue(setupScript ?? "");
    setPersistedValue(setupScript ?? "");
    setErrorMessage(null);
  }, []);

  const applyDraftSaveError = useCallback((error: unknown): void => {
    setErrorMessage(getErrorMessage(error));
  }, []);

  return {
    draftValue,
    errorMessage,
    hasUnsavedChanges: draftValue !== persistedValue,
    savedValue: persistedValue,
    applyDraftSaveError,
    applySavedSetupScript,
    buildDraftChanges,
    onChange,
  };
}
