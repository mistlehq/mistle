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

type SandboxProfileMetaEditorState = KeyedValue<{
  displayName: string;
  persistedDisplayName: string;
  profileNameDraft: string;
}>;

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
  const [editorState, setEditorState] = useState<SandboxProfileMetaEditorState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const persistedDisplayName = input.loadedProfile?.displayName ?? "";
  const currentEditorState = editorState?.sourceKey === metaSourceKey ? editorState.value : null;
  const displayName = currentEditorState?.displayName ?? persistedDisplayName;
  const profileNameDraft = currentEditorState?.profileNameDraft ?? displayName;

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
        setEditorState({
          sourceKey: metaSourceKey,
          value: {
            displayName: updatedProfile.displayName,
            persistedDisplayName: updatedProfile.displayName,
            profileNameDraft: updatedProfile.displayName,
          },
        });
      }
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
    setEditorState({
      sourceKey: metaSourceKey,
      value: {
        displayName: nextValue,
        persistedDisplayName,
        profileNameDraft,
      },
    });
    setSaveError(null);
  }

  function onProfileNameEditStart(): void {
    setEditorState({
      sourceKey: metaSourceKey,
      value: {
        displayName,
        persistedDisplayName,
        profileNameDraft: displayName,
      },
    });
    setIsEditingProfileName(true);
    setSaveError(null);
  }

  function onProfileNameDraftChange(nextValue: string): void {
    setEditorState({
      sourceKey: metaSourceKey,
      value: {
        displayName,
        persistedDisplayName,
        profileNameDraft: nextValue,
      },
    });
    setSaveError(null);
  }

  function onProfileNameEditCancel(): void {
    setEditorState({
      sourceKey: metaSourceKey,
      value: {
        displayName,
        persistedDisplayName,
        profileNameDraft: displayName,
      },
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
      setEditorState({
        sourceKey: metaSourceKey,
        value: {
          displayName,
          persistedDisplayName,
          profileNameDraft: persistedDisplayName,
        },
      });
      return;
    }

    setEditorState({
      sourceKey: metaSourceKey,
      value: {
        displayName: decision.displayName,
        persistedDisplayName,
        profileNameDraft,
      },
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
