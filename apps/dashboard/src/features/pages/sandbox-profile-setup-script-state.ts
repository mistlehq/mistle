import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionSetupScript,
  listSandboxProfileVersions,
  putSandboxProfileVersionSetupScript,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";

type AutoSaveStatus = "idle" | "saving" | "saved" | "saved-fading";

export function resolveLatestVersion(versions: readonly SandboxProfileVersion[]): number | null {
  if (versions.length === 0) {
    return null;
  }

  let latestVersion = versions[0]?.version;
  if (latestVersion === undefined) {
    return null;
  }

  for (const candidate of versions) {
    if (candidate.version > latestVersion) {
      latestVersion = candidate.version;
    }
  }

  return latestVersion;
}

export function useSandboxProfileSetupScriptLoader(input: { profileId: string }): {
  setupScriptQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  setupScript: string | null;
  version: number | null;
} {
  const profileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(input.profileId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: input.profileId,
        signal,
      }),
    retry: false,
  });
  const version = resolveLatestVersion(profileVersionsQuery.data?.versions ?? []);
  const setupScriptQuery = useQuery({
    queryKey:
      version === null
        ? sandboxProfileVersionSetupScriptQueryKey({
            profileId: input.profileId,
            version: 0,
          })
        : sandboxProfileVersionSetupScriptQueryKey({
            profileId: input.profileId,
            version,
          }),
    queryFn: async ({ signal }) => {
      if (version === null) {
        throw new Error("No sandbox profile version is available for this profile.");
      }

      return getSandboxProfileVersionSetupScript({
        profileId: input.profileId,
        version,
        signal,
      });
    },
    enabled: version !== null && !profileVersionsQuery.isPending,
    retry: false,
  });

  return {
    setupScriptQuery: {
      isError:
        profileVersionsQuery.isError ||
        (!profileVersionsQuery.isPending && version === null) ||
        setupScriptQuery.isError,
      error:
        profileVersionsQuery.error ??
        (!profileVersionsQuery.isPending && version === null
          ? new Error("No sandbox profile version is available for this profile.")
          : setupScriptQuery.error),
      isPending: profileVersionsQuery.isPending || setupScriptQuery.isPending,
    },
    setupScript: setupScriptQuery.data?.setupScript ?? null,
    version,
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
    isSaving: saveMutation.isPending,
    onChange,
    onBlur,
  };
}
