import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { sandboxProfileVersionSetupScriptQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionSetupScript,
  putSandboxProfileVersionSetupScript,
} from "../sandbox-profiles/sandbox-profiles-service.js";
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
  flushDraftChanges: () => Promise<boolean>;
  isSaving: boolean;
  onChange: (nextValue: string) => void;
} {
  const [draftValue, setDraftValue] = useState(input.setupScript ?? "");
  const [persistedValue, setPersistedValue] = useState(input.setupScript ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const saveSequenceRef = useRef(0);
  const previousSetupScriptRef = useRef(input.setupScript);
  const pendingSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const draftValueRef = useRef(draftValue);
  const persistedValueRef = useRef(persistedValue);
  draftValueRef.current = draftValue;
  persistedValueRef.current = persistedValue;

  const saveMutation = useMutation({
    mutationFn: async (setupScript: string | null) =>
      putSandboxProfileVersionSetupScript({
        profileId: input.profileId,
        version: input.version,
        setupScript,
      }),
  });
  const saveMutationIsPending = saveMutation.isPending;
  const saveMutationMutateAsync = saveMutation.mutateAsync;

  useEffect(() => {
    const previousSetupScript = previousSetupScriptRef.current;
    previousSetupScriptRef.current = input.setupScript;

    if (input.setupScript === previousSetupScript) {
      return;
    }

    saveSequenceRef.current += 1;
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
    saveSequenceRef.current += 1;
    setDraftValue(nextValue);
    clearFeedback();
  }

  const saveCurrentDraft = useCallback((): Promise<boolean> => {
    if (saveMutationIsPending) {
      return pendingSavePromiseRef.current ?? Promise.resolve(false);
    }

    if (draftValueRef.current === persistedValueRef.current) {
      clearFeedback();
      return Promise.resolve(true);
    }

    const nextDraftValue = draftValueRef.current;
    const nextSetupScript = nextDraftValue.length === 0 ? null : nextDraftValue;
    const currentSaveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = currentSaveSequence;
    setErrorMessage(null);

    const savePromise = saveMutationMutateAsync(nextSetupScript)
      .then((response) => {
        if (saveSequenceRef.current !== currentSaveSequence) {
          return false;
        }

        setDraftValue(response.setupScript ?? "");
        setPersistedValue(response.setupScript ?? "");
        return true;
      })
      .catch((error: unknown) => {
        if (saveSequenceRef.current !== currentSaveSequence) {
          return false;
        }

        setErrorMessage(getErrorMessage(error));
        return false;
      })
      .finally(() => {
        if (pendingSavePromiseRef.current === savePromise) {
          pendingSavePromiseRef.current = null;
        }
      });
    pendingSavePromiseRef.current = savePromise;
    return savePromise;
  }, [saveMutationIsPending, saveMutationMutateAsync]);

  return {
    draftValue,
    errorMessage,
    hasUnsavedChanges: draftValue !== persistedValue,
    flushDraftChanges: saveCurrentDraft,
    isSaving: saveMutation.isPending,
    onChange,
  };
}
