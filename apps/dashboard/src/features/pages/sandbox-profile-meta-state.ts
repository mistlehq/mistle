import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { isSandboxProfileStatus } from "../sandbox-profiles/sandbox-profiles-formatters.js";
import {
  createSandboxProfile,
  updateSandboxProfile,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileStatus } from "../sandbox-profiles/sandbox-profiles-types.js";
import { resolveProfileNameCommitDecision } from "./sandbox-profile-title-edit.js";

type SandboxProfileEditorFormState = {
  displayName: string;
  status: SandboxProfileStatus;
};

type UseSandboxProfileMetaStateInput = {
  mode: "create" | "edit";
  profileId: string | undefined;
  loadedProfile:
    | {
        displayName: string;
        status: SandboxProfileStatus;
      }
    | undefined;
  navigate: (to: string) => void | Promise<void>;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
};

function resolveStatusFromToggleChecked(checked: boolean): SandboxProfileStatus {
  return checked ? "active" : "inactive";
}

function resolveStatusToggleChecked(status: SandboxProfileStatus): boolean {
  return status === "active";
}

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
  onStatusToggleChange: (checked: boolean) => void;
  onCreate: () => void;
  onCancelCreate: () => void;
} {
  const [formState, setFormState] = useState<SandboxProfileEditorFormState>({
    displayName: "",
    status: "active",
  });
  const [persistedFormState, setPersistedFormState] = useState<SandboxProfileEditorFormState>({
    displayName: "",
    status: "active",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");

  useEffect(() => {
    if (input.mode !== "edit") {
      return;
    }
    if (input.loadedProfile === undefined) {
      return;
    }

    const loadedState: SandboxProfileEditorFormState = {
      displayName: input.loadedProfile.displayName,
      status: input.loadedProfile.status,
    };
    setFormState(loadedState);
    setPersistedFormState(loadedState);
    setProfileNameDraft(loadedState.displayName);
  }, [input.loadedProfile, input.mode]);

  const createMutation = useMutation({
    mutationFn: async (createInput: SandboxProfileEditorFormState) =>
      createSandboxProfile({
        payload: {
          displayName: createInput.displayName,
          status: createInput.status,
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
          ...(updateInput.changes.status === undefined
            ? {}
            : { status: updateInput.changes.status }),
        },
      }),
    onSuccess: async (updatedProfile, variables) => {
      setFormState((currentState) => ({
        ...currentState,
        ...(variables.changes.displayName === undefined
          ? {}
          : { displayName: updatedProfile.displayName }),
        ...(variables.changes.status === undefined ? {} : { status: updatedProfile.status }),
      }));
      setPersistedFormState((currentState) => ({
        ...currentState,
        ...(variables.changes.displayName === undefined
          ? {}
          : { displayName: updatedProfile.displayName }),
        ...(variables.changes.status === undefined ? {} : { status: updatedProfile.status }),
      }));
      setProfileNameDraft(updatedProfile.displayName);
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

  const trimmedDisplayName = formState.displayName.trim();
  const editTitleProfileName =
    trimmedDisplayName.length > 0 ? trimmedDisplayName : (input.profileId ?? "Profile");

  function onDisplayNameChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      displayName: nextValue,
    }));
    setSaveError(null);
  }

  function onProfileNameEditStart(): void {
    setProfileNameDraft(formState.displayName);
    setIsEditingProfileName(true);
    setSaveError(null);
  }

  function onProfileNameDraftChange(nextValue: string): void {
    setProfileNameDraft(nextValue);
    setSaveError(null);
  }

  function onProfileNameEditCancel(): void {
    setProfileNameDraft(formState.displayName);
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
      persistedDisplayName: persistedFormState.displayName,
    });
    setIsEditingProfileName(false);
    if (decision.action === "revert") {
      setProfileNameDraft(persistedFormState.displayName);
      return;
    }

    setFormState((currentState) => ({
      ...currentState,
      displayName: decision.displayName,
    }));

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

  function onStatusChange(nextValue: string): void {
    if (!isSandboxProfileStatus(nextValue)) {
      throw new Error(`Unsupported sandbox profile status: ${nextValue}`);
    }
    setFormState((currentState) => ({
      ...currentState,
      status: nextValue,
    }));
    setSaveError(null);
  }

  function onStatusToggleChange(checked: boolean): void {
    const nextStatus = resolveStatusFromToggleChecked(checked);

    if (input.mode === "create") {
      onStatusChange(nextStatus);
      return;
    }
    if (input.profileId === undefined || updateMutation.isPending) {
      return;
    }
    if (nextStatus === persistedFormState.status) {
      return;
    }

    const previousPersistedStatus = persistedFormState.status;
    onStatusChange(nextStatus);
    updateMutation.mutate(
      {
        profileId: input.profileId,
        changes: {
          status: nextStatus,
        },
      },
      {
        onError: () => {
          setFormState((currentState) => ({
            ...currentState,
            status: previousPersistedStatus,
          }));
        },
      },
    );
  }

  function onCreate(): void {
    if (trimmedDisplayName.length === 0 || createMutation.isPending) {
      return;
    }

    createMutation.mutate({
      displayName: trimmedDisplayName,
      status: formState.status,
    });
  }

  function onCancelCreate(): void {
    void input.navigate("/sandbox-profiles");
  }

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
    onStatusToggleChange,
    onCreate,
    onCancelCreate,
  };
}

export { resolveStatusToggleChecked };
