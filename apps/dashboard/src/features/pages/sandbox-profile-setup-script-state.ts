import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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

  const saveMutation = useMutation({
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

  function onBlur(): void {
    if (saveMutation.isPending) {
      return;
    }

    if (draftValue === persistedValue) {
      clearFeedback();
      return;
    }

    const nextSetupScript = draftValue.length === 0 ? null : draftValue;
    const currentSaveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = currentSaveSequence;
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setErrorMessage(null);
    setSaveStatus("saving");

    void saveMutation
      .mutateAsync(nextSetupScript)
      .then((response) => {
        if (saveSequenceRef.current !== currentSaveSequence) {
          return;
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
      })
      .catch((error: unknown) => {
        if (saveSequenceRef.current !== currentSaveSequence) {
          return;
        }

        setSaveStatus("idle");
        setErrorMessage(getErrorMessage(error));
      });
  }

  return {
    draftValue,
    errorMessage,
    saveStatus,
    hasUnsavedChanges: draftValue !== persistedValue,
    isSaving: saveMutation.isPending,
    onChange,
    onBlur,
  };
}
