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

type CommonInput = {
  navigate: (to: string) => void | Promise<void>;
  invalidateSandboxProfiles: () => Promise<void>;
};

type EditInput = CommonInput & {
  profileId: string;
  loadedProfile: {
    displayName: string;
  };
  invalidateProfileDetail: (profileId: string) => Promise<void>;
};

export function useCreateSandboxProfileMetaState(input: CommonInput): {
  formState: SandboxProfileEditorFormState;
  saveError: string | null;
  pageTitle: string;
  isDisplayNameInvalid: boolean;
  isCreating: boolean;
  onDisplayNameChange: (nextValue: string) => void;
  onCreate: () => void;
  onCancelCreate: () => void;
} {
  const [displayName, setDisplayName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const trimmedDisplayName = displayName.trim();

  function onCreate(): void {
    if (trimmedDisplayName.length === 0 || createMutation.isPending) {
      return;
    }

    createMutation.mutate({
      displayName: trimmedDisplayName,
    });
  }

  return {
    formState: {
      displayName,
    },
    saveError,
    pageTitle: "Create Profile",
    isDisplayNameInvalid: trimmedDisplayName.length === 0,
    isCreating: createMutation.isPending,
    onDisplayNameChange: (nextValue) => {
      setDisplayName(nextValue);
      setSaveError(null);
    },
    onCreate,
    onCancelCreate: () => {
      void input.navigate("/sandbox-profiles");
    },
  };
}

export function useEditSandboxProfileMetaState(input: EditInput): {
  formState: SandboxProfileEditorFormState;
  saveError: string | null;
  pageTitle: string;
  isEditingProfileName: boolean;
  profileNameDraft: string;
  isUpdating: boolean;
  onDisplayNameChange: (nextValue: string) => void;
  onProfileNameEditStart: () => void;
  onProfileNameDraftChange: (nextValue: string) => void;
  onProfileNameEditCancel: () => void;
  onProfileNameEditCommit: () => void;
} {
  const [displayName, setDisplayName] = useState(input.loadedProfile.displayName);
  const [persistedDisplayName, setPersistedDisplayName] = useState(input.loadedProfile.displayName);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(input.loadedProfile.displayName);

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
        setDisplayName(updatedProfile.displayName);
        setPersistedDisplayName(updatedProfile.displayName);
        setProfileNameDraft(updatedProfile.displayName);
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
  const editTitleProfileName = trimmedDisplayName.length > 0 ? trimmedDisplayName : input.profileId;

  function onProfileNameEditCommit(): void {
    if (updateMutation.isPending) {
      setIsEditingProfileName(false);
      return;
    }

    const decision = resolveProfileNameCommitDecision({
      draftDisplayName: profileNameDraft,
      persistedDisplayName,
    });
    setIsEditingProfileName(false);
    if (decision.action === "revert") {
      setProfileNameDraft(persistedDisplayName);
      return;
    }

    setDisplayName(decision.displayName);

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

  return {
    formState: {
      displayName,
    },
    saveError,
    pageTitle: editTitleProfileName,
    isEditingProfileName,
    profileNameDraft,
    isUpdating: updateMutation.isPending,
    onDisplayNameChange: (nextValue) => {
      setDisplayName(nextValue);
      setSaveError(null);
    },
    onProfileNameEditStart: () => {
      setProfileNameDraft(displayName);
      setIsEditingProfileName(true);
      setSaveError(null);
    },
    onProfileNameDraftChange: (nextValue) => {
      setProfileNameDraft(nextValue);
      setSaveError(null);
    },
    onProfileNameEditCancel: () => {
      setProfileNameDraft(displayName);
      setIsEditingProfileName(false);
      setSaveError(null);
    },
    onProfileNameEditCommit,
  };
}
