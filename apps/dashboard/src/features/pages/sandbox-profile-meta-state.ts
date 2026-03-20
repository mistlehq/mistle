import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  createSandboxProfile,
  updateSandboxProfile,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { resolveProfileNameCommitDecision } from "./sandbox-profile-title-edit.js";

type SandboxProfileEditorFormState = {
  displayName: string;
};

type UseSandboxProfileMetaStateInput = {
  mode: "create" | "edit";
  profileId: string | undefined;
  loadedProfile:
    | {
        displayName: string;
      }
    | undefined;
  navigate: (to: string) => void | Promise<void>;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
};

type KeyedValue<T> = {
  sourceKey: string;
  value: T;
};

export function useSandboxProfileMetaState(input: UseSandboxProfileMetaStateInput): {
  formState: SandboxProfileEditorFormState;
  saveError: string | null;
  pageTitle: string;
  isDisplayNameInvalid: boolean;
  isEditingProfileName: boolean;
  profileNameDraft: string;
  isCreating: boolean;
  isUpdating: boolean;
  onDisplayNameChange: (nextValue: string) => void;
  onProfileNameEditStart: () => void;
  onProfileNameDraftChange: (nextValue: string) => void;
  onProfileNameEditCancel: () => void;
  onProfileNameEditCommit: () => void;
  onCreate: () => void;
  onCancelCreate: () => void;
} {
  const metaSourceKey = input.mode === "edit" ? `edit:${input.profileId ?? "missing"}` : "create";
  const [displayNameState, setDisplayNameState] = useState<KeyedValue<string> | null>(null);
  const [persistedDisplayNameState, setPersistedDisplayNameState] =
    useState<KeyedValue<string> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraftState, setProfileNameDraftState] = useState<KeyedValue<string> | null>(
    null,
  );
  const persistedDisplayName =
    persistedDisplayNameState?.sourceKey === metaSourceKey
      ? persistedDisplayNameState.value
      : (input.loadedProfile?.displayName ?? "");
  const displayName =
    displayNameState?.sourceKey === metaSourceKey ? displayNameState.value : persistedDisplayName;
  const profileNameDraft =
    profileNameDraftState?.sourceKey === metaSourceKey ? profileNameDraftState.value : displayName;

  const createMutation = useMutation({
    mutationFn: async (createInput: SandboxProfileEditorFormState) =>
      createSandboxProfile({
        payload: {
          displayName: createInput.displayName,
        },
      }),
    onSuccess: async (createdProfile) => {
      setSaveError(null);
      await input.invalidateSandboxProfiles();
      await input.navigate(`/sandbox-profiles/${createdProfile.id}`);
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create sandbox profile.",
        }),
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updateInput: {
      profileId: string;
      changes: Partial<SandboxProfileEditorFormState>;
    }) =>
      updateSandboxProfile({
        payload: {
          profileId: updateInput.profileId,
          ...(updateInput.changes.displayName === undefined
            ? {}
            : { displayName: updateInput.changes.displayName }),
        },
      }),
    onSuccess: async (updatedProfile, variables) => {
      if (variables.changes.displayName !== undefined) {
        setDisplayNameState({
          sourceKey: metaSourceKey,
          value: updatedProfile.displayName,
        });
        setPersistedDisplayNameState({
          sourceKey: metaSourceKey,
          value: updatedProfile.displayName,
        });
      }
      setProfileNameDraftState({
        sourceKey: metaSourceKey,
        value: updatedProfile.displayName,
      });
      setSaveError(null);

      await input.invalidateSandboxProfiles();
      await input.invalidateProfileDetail(updatedProfile.id);
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update sandbox profile.",
        }),
      );
    },
  });

  const trimmedDisplayName = displayName.trim();
  const editTitleProfileName =
    trimmedDisplayName.length > 0 ? trimmedDisplayName : (input.profileId ?? "Profile");

  function onDisplayNameChange(nextValue: string): void {
    setDisplayNameState({
      sourceKey: metaSourceKey,
      value: nextValue,
    });
    setSaveError(null);
  }

  function onProfileNameEditStart(): void {
    setProfileNameDraftState({
      sourceKey: metaSourceKey,
      value: displayName,
    });
    setIsEditingProfileName(true);
    setSaveError(null);
  }

  function onProfileNameDraftChange(nextValue: string): void {
    setProfileNameDraftState({
      sourceKey: metaSourceKey,
      value: nextValue,
    });
    setSaveError(null);
  }

  function onProfileNameEditCancel(): void {
    setProfileNameDraftState({
      sourceKey: metaSourceKey,
      value: displayName,
    });
    setIsEditingProfileName(false);
    setSaveError(null);
  }

  function onProfileNameEditCommit(): void {
    if (input.mode !== "edit" || input.profileId === undefined || updateMutation.isPending) {
      setIsEditingProfileName(false);
      return;
    }

    const decision = resolveProfileNameCommitDecision({
      draftDisplayName: profileNameDraft,
      persistedDisplayName,
    });
    setIsEditingProfileName(false);
    if (decision.action === "revert") {
      setProfileNameDraftState({
        sourceKey: metaSourceKey,
        value: persistedDisplayName,
      });
      return;
    }

    setDisplayNameState({
      sourceKey: metaSourceKey,
      value: decision.displayName,
    });

    if (decision.action === "noop") {
      return;
    }

    updateMutation.mutate({
      profileId: input.profileId,
      changes: {
        displayName: decision.displayName,
      },
    });
  }

  function onCreate(): void {
    if (trimmedDisplayName.length === 0 || createMutation.isPending) {
      return;
    }

    createMutation.mutate({
      displayName: trimmedDisplayName,
    });
  }

  function onCancelCreate(): void {
    void input.navigate("/sandbox-profiles");
  }

  const formState: SandboxProfileEditorFormState = {
    displayName,
  };

  return {
    formState,
    saveError,
    pageTitle: input.mode === "create" ? "Create Profile" : editTitleProfileName,
    isDisplayNameInvalid: trimmedDisplayName.length === 0,
    isEditingProfileName,
    profileNameDraft,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    onDisplayNameChange,
    onProfileNameEditStart,
    onProfileNameDraftChange,
    onProfileNameEditCancel,
    onProfileNameEditCommit,
    onCreate,
    onCancelCreate,
  };
}
