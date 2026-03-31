import { systemScheduler } from "@mistle/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { deleteUserAvatar, uploadUserAvatar } from "../settings/media/avatar-media-service.js";
import { updateProfileDisplayName } from "../settings/profile/profile-service.js";
import { resolveUserDisplayName } from "../shared/user-display-name.js";
import { useRequiredSession } from "../shell/require-auth.js";
import { SESSION_QUERY_KEY } from "../shell/session-query-key.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

export function ProfileSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const session = useRequiredSession();
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    if (!saveSuccess) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setSaveSuccess(false);
    }, 2000);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [saveSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (displayName: string) => updateProfileDisplayName({ displayName }),
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: SESSION_QUERY_KEY,
      });
      setFieldError(null);
      setSaveSuccess(true);
    },
    onError: (error: unknown) => {
      setFieldError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update profile.",
        }),
      );
      setSaveSuccess(false);
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) =>
      uploadUserAvatar({
        userId: session.user.id,
        file,
      }),
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: SESSION_QUERY_KEY,
      });
      setAvatarError(null);
    },
    onError: (error: unknown) => {
      setAvatarError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not upload avatar.",
        }),
      );
    },
  });

  const deleteAvatarMutation = useMutation({
    mutationFn: async () => deleteUserAvatar(),
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: SESSION_QUERY_KEY,
      });
      setAvatarError(null);
    },
    onError: (error: unknown) => {
      setAvatarError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not remove avatar.",
        }),
      );
    },
  });

  const persistedDisplayName = resolveUserDisplayName(session.user);
  const avatarUrl = typeof session.user.image === "string" ? session.user.image : null;

  return (
    <ProfileSettingsEditor
      avatarError={avatarError}
      avatarMutating={uploadAvatarMutation.isPending || deleteAvatarMutation.isPending}
      avatarUrl={avatarUrl}
      key={`${session.user.email}:${persistedDisplayName}`}
      email={session.user.email}
      fieldError={fieldError}
      onAvatarFileSelected={(file) => {
        setAvatarError(null);
        void uploadAvatarMutation.mutateAsync(file);
      }}
      onAvatarRemove={() => {
        setAvatarError(null);
        void deleteAvatarMutation.mutateAsync();
      }}
      onDisplayNameSave={(displayNameDraft) => {
        setFieldError(null);
        setSaveSuccess(false);
        void saveMutation.mutateAsync(displayNameDraft.trim());
      }}
      onResetFeedback={() => {
        setFieldError(null);
        setSaveSuccess(false);
      }}
      persistedDisplayName={persistedDisplayName}
      saveSuccess={saveSuccess}
      saving={saveMutation.isPending}
    />
  );
}

function ProfileSettingsEditor(input: {
  avatarUrl: string | null;
  avatarError: string | null;
  avatarMutating: boolean;
  persistedDisplayName: string;
  email: string;
  fieldError: string | null;
  saveSuccess: boolean;
  saving: boolean;
  onAvatarFileSelected: (file: File) => void;
  onAvatarRemove: () => void;
  onDisplayNameSave: (displayNameDraft: string) => void;
  onResetFeedback: () => void;
}): React.JSX.Element {
  const [displayNameDraft, setDisplayNameDraft] = useState(input.persistedDisplayName);

  const normalizedDisplayName = displayNameDraft.trim();
  const hasDirtyChanges = normalizedDisplayName !== input.persistedDisplayName.trim();
  const displayName = normalizedDisplayName.length > 0 ? normalizedDisplayName : input.email;

  return (
    <ProfileSettingsPageView
      avatarError={input.avatarError}
      avatarMutating={input.avatarMutating}
      avatarUrl={input.avatarUrl}
      displayName={displayName}
      displayNameDraft={displayNameDraft}
      email={input.email}
      fieldError={input.fieldError}
      hasDirtyChanges={hasDirtyChanges}
      hasAvatar={input.avatarUrl !== null}
      onAvatarFileSelected={input.onAvatarFileSelected}
      onAvatarRemove={input.onAvatarRemove}
      onCancelChanges={() => {
        setDisplayNameDraft(input.persistedDisplayName);
        input.onResetFeedback();
      }}
      onDisplayNameChange={(nextValue) => {
        setDisplayNameDraft(nextValue);
        input.onResetFeedback();
      }}
      onSaveChanges={() => {
        input.onDisplayNameSave(displayNameDraft);
      }}
      saveSuccess={input.saveSuccess}
      saving={input.saving}
    />
  );
}
