import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  createSandboxProfile,
  updateSandboxProfile,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { useAutoSaveAction } from "../shared/use-auto-save-action.js";

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

  const updateAction = useAutoSaveAction({
    save: async (normalizedDisplayName: string) => {
      const updatedProfile = await updateSandboxProfile({
        payload: {
          profileId: input.profileId,
          displayName: normalizedDisplayName,
        },
      });

      setDisplayName(updatedProfile.displayName);
      setPersistedDisplayName(updatedProfile.displayName);
    },
    afterSave: async () => {
      await input.invalidateSandboxProfiles();
      await input.invalidateProfileDetail(input.profileId);
    },
  });

  const trimmedDisplayName = displayName.trim();
  const editTitleProfileName = trimmedDisplayName.length > 0 ? trimmedDisplayName : input.profileId;

  return {
    formState: {
      displayName,
    },
    pageTitle: editTitleProfileName,
    isUpdating: updateAction.isSaving,
    onDisplayNameChange: (nextValue) => {
      setDisplayName(nextValue);
    },
    onProfileNameSave: async (nextValue) => {
      const normalizedDisplayName = nextValue.trim();
      if (normalizedDisplayName === persistedDisplayName.trim()) {
        return;
      }

      await updateAction.run(normalizedDisplayName);
    },
  };
}
