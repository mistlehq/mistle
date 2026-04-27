import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { sandboxProfileVersionSetupScriptQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionSetupScript,
  putSandboxProfileVersionSetupScript,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import {
  AppShellLoadingIndicators,
  createAppShellLoadingIndicatorMeta,
} from "../shell/app-shell-loading-indicator-meta.js";

type AutoSaveStatus = "idle" | "saving" | "saved" | "saved-fading";

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
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
  scheduler?: Scheduler;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
}): {
  draftValue: string;
  errorMessage: string | null;
  saveStatus: AutoSaveStatus;
  hasUnsavedChanges: boolean;
  flushDraftChanges: () => Promise<boolean>;
  isSaving: boolean;
  onChange: (nextValue: string) => void;
  onBlur: () => void;
} {
  const scheduler = input.scheduler ?? systemScheduler;
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const [draftValue, setDraftValue] = useState(input.setupScript ?? "");
  const [persistedValue, setPersistedValue] = useState(input.setupScript ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AutoSaveStatus>("idle");
  const saveSequenceRef = useRef(0);
  const previousSetupScriptRef = useRef(input.setupScript);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);
  const pendingSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const draftValueRef = useRef(draftValue);
  const persistedValueRef = useRef(persistedValue);
  draftValueRef.current = draftValue;
  persistedValueRef.current = persistedValue;

  const saveMutation = useMutation({
    meta: createAppShellLoadingIndicatorMeta(AppShellLoadingIndicators.AUTOSAVE),
    mutationFn: async (setupScript: string | null) =>
      putSandboxProfileVersionSetupScript({
        profileId: input.profileId,
        version: input.version,
        setupScript,
      }),
    onSuccess: async (response) => {
      setPersistedValue(response.setupScript ?? "");
      await input.invalidateVersionSetupScript({
        profileId: input.profileId,
        version: input.version,
      });
    },
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
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setDraftValue(input.setupScript ?? "");
    setPersistedValue(input.setupScript ?? "");
    setErrorMessage(null);
    setSaveStatus("idle");
  }, [input.setupScript, scheduler]);

  useEffect(() => {
    return () => {
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler,
      });
    };
  }, [scheduler]);

  function clearFeedback(): void {
    if (errorMessage === null && saveStatus === "idle") {
      return;
    }

    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setErrorMessage(null);
    setSaveStatus("idle");
  }

  function onChange(nextValue: string): void {
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
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setErrorMessage(null);
    setSaveStatus("saving");

    const savePromise = saveMutationMutateAsync(nextSetupScript)
      .then((response) => {
        if (saveSequenceRef.current !== currentSaveSequence) {
          return true;
        }

        setDraftValue(response.setupScript ?? "");
        setPersistedValue(response.setupScript ?? "");
        setSaveStatus("saved");
        scheduleSavedStateReset({
          fadeEndTimeoutRef,
          fadeStartTimeoutRef,
          onFadeEnd: () => {
            setSaveStatus("idle");
          },
          onFadeStart: () => {
            setSaveStatus("saved-fading");
          },
          scheduler,
          successFadeDurationMs,
          successVisibleDurationMs,
        });
        return true;
      })
      .catch((error: unknown) => {
        if (saveSequenceRef.current !== currentSaveSequence) {
          return false;
        }

        setSaveStatus("idle");
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
  }, [
    saveMutationIsPending,
    saveMutationMutateAsync,
    scheduler,
    successFadeDurationMs,
    successVisibleDurationMs,
  ]);

  function onBlur(): void {
    void saveCurrentDraft();
  }

  return {
    draftValue,
    errorMessage,
    saveStatus,
    hasUnsavedChanges: draftValue !== persistedValue,
    flushDraftChanges: saveCurrentDraft,
    isSaving: saveMutation.isPending,
    onChange,
    onBlur,
  };
}
