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
  onStatusSelectChange: (nextStatus: SandboxProfileStatus) => void;
  onCreate: () => void;
  onCancelCreate: () => void;
} {
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<SandboxProfileStatus>("active");
  const [persistedDisplayName, setPersistedDisplayName] = useState("");
  const [persistedStatus, setPersistedStatus] = useState<SandboxProfileStatus>("active");
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

    setDisplayName(input.loadedProfile.displayName);
    setStatus(input.loadedProfile.status);
    setPersistedDisplayName(input.loadedProfile.displayName);
    setPersistedStatus(input.loadedProfile.status);
    setProfileNameDraft(input.loadedProfile.displayName);
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
      if (variables.changes.displayName !== undefined) {
        setDisplayName(updatedProfile.displayName);
        setPersistedDisplayName(updatedProfile.displayName);
      }
      if (variables.changes.status !== undefined) {
        setStatus(updatedProfile.status);
        setPersistedStatus(updatedProfile.status);
      }
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

  const trimmedDisplayName = displayName.trim();
  const editTitleProfileName =
    trimmedDisplayName.length > 0 ? trimmedDisplayName : (input.profileId ?? "Profile");

  function onDisplayNameChange(nextValue: string): void {
    setDisplayName(nextValue);
    setSaveError(null);
  }

  function onProfileNameEditStart(): void {
    setProfileNameDraft(displayName);
    setIsEditingProfileName(true);
    setSaveError(null);
  }

  function onProfileNameDraftChange(nextValue: string): void {
    setProfileNameDraft(nextValue);
    setSaveError(null);
  }

  function onProfileNameEditCancel(): void {
    setProfileNameDraft(displayName);
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

  function setDraftStatus(nextValue: string): void {
    if (!isSandboxProfileStatus(nextValue)) {
      throw new Error(`Unsupported sandbox profile status: ${nextValue}`);
    }
    setStatus(nextValue);
    setSaveError(null);
  }

  function onStatusSelectChange(nextStatus: SandboxProfileStatus): void {
    if (input.mode === "create") {
      setDraftStatus(nextStatus);
      return;
    }
    if (input.profileId === undefined || updateMutation.isPending) {
      return;
    }
    if (nextStatus === persistedStatus) {
      return;
    }

    const previousPersistedStatus = persistedStatus;
    setDraftStatus(nextStatus);
    updateMutation.mutate(
      {
        profileId: input.profileId,
        changes: {
          status: nextStatus,
        },
      },
      {
        onError: () => {
          setStatus(previousPersistedStatus);
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
      status,
    });
  }

  function onCancelCreate(): void {
    void input.navigate("/sandbox-profiles");
  }

  const formState: SandboxProfileEditorFormState = {
    displayName,
    status,
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
    onStatusSelectChange,
    onCreate,
    onCancelCreate,
  };
}
