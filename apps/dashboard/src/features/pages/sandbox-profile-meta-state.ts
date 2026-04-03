import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  createSandboxProfile,
  updateSandboxProfile,
} from "../sandbox-profiles/sandbox-profiles-service.js";

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
  pageTitle: string;
  isUpdating: boolean;
  onDisplayNameChange: (nextValue: string) => void;
  onProfileNameSave: (nextValue: string) => Promise<void>;
} {
  const [displayName, setDisplayName] = useState(input.loadedProfile.displayName);
  const [persistedDisplayName, setPersistedDisplayName] = useState(input.loadedProfile.displayName);

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
      }

      await input.invalidateSandboxProfiles();
      await input.invalidateProfileDetail(updatedProfile.id);
    },
  });

  const trimmedDisplayName = displayName.trim();
  const editTitleProfileName = trimmedDisplayName.length > 0 ? trimmedDisplayName : input.profileId;

  return {
    formState: {
      displayName,
    },
    pageTitle: editTitleProfileName,
    isUpdating: updateMutation.isPending,
    onDisplayNameChange: (nextValue) => {
      setDisplayName(nextValue);
    },
    onProfileNameSave: async (nextValue) => {
      const normalizedDisplayName = nextValue.trim();
      if (normalizedDisplayName === persistedDisplayName.trim()) {
        return;
      }

      try {
        const updatedProfile = await updateMutation.mutateAsync({
          profileId: input.profileId,
          changes: {
            displayName: normalizedDisplayName,
          },
        });

        setDisplayName(updatedProfile.displayName);
        setPersistedDisplayName(updatedProfile.displayName);
      } catch (error) {
        throw new Error(
          resolveApiErrorMessage({
            error,
            fallbackMessage: "Could not update sandbox profile.",
          }),
        );
      }
    },
  };
}
