import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  deleteProfileImage,
  getProfileImage,
  updateProfileDisplayName,
  uploadProfileImage,
} from "../settings/profile/profile-service.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { resolveUserDisplayName } from "../shared/user-display-name.js";
import { useRequiredSession } from "../shell/require-auth.js";
import { SESSION_QUERY_KEY } from "../shell/session-query-key.js";
import { updateSessionUserImage } from "../shell/session-user-image.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const PROFILE_IMAGE_QUERY_KEY: readonly ["settings", "profile-image"] = [
  "settings",
  "profile-image",
];

export function ProfileSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const session = useRequiredSession();
  const [profileImageOperationErrorMessage, setProfileImageOperationErrorMessage] = useState<
    string | null
  >(null);
  const { title, description } = resolvePageFrameText(pageMeta, "Profile");
  const profileImageQuery = useQuery({
    queryKey: PROFILE_IMAGE_QUERY_KEY,
    queryFn: getProfileImage,
    staleTime: 15 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (displayName: string) => updateProfileDisplayName({ displayName }),
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
  });
  const uploadProfileImageMutation = useMutation({
    mutationFn: async (file: File) => uploadProfileImage({ file }),
    onMutate: async () => {
      setProfileImageOperationErrorMessage(null);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(PROFILE_IMAGE_QUERY_KEY, {
        imageUrl: result.imageUrl,
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, (currentSession) =>
        updateSessionUserImage(currentSession ?? null, result.imageUrl),
      );
      setProfileImageOperationErrorMessage(null);
    },
    onError: (error) => {
      setProfileImageOperationErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not upload profile image.",
        }),
      );
    },
  });
  const deleteProfileImageMutation = useMutation({
    mutationFn: deleteProfileImage,
    onMutate: async () => {
      setProfileImageOperationErrorMessage(null);
    },
    onSuccess: async () => {
      queryClient.setQueryData(PROFILE_IMAGE_QUERY_KEY, {
        imageUrl: null,
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, (currentSession) =>
        updateSessionUserImage(currentSession ?? null, null),
      );
      setProfileImageOperationErrorMessage(null);
    },
    onError: (error) => {
      setProfileImageOperationErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not delete profile image.",
        }),
      );
    },
  });

  const persistedDisplayName = resolveUserDisplayName(session.user);
  const imageUrl = profileImageQuery.data?.imageUrl ?? null;
  const profileImageErrorMessage =
    profileImageOperationErrorMessage ??
    (profileImageQuery.isError
      ? resolveApiErrorMessage({
          error: profileImageQuery.error,
          fallbackMessage: "Could not load profile image.",
        })
      : null);

  return (
    <FormPageFrame description={description} title={title}>
      <ProfileSettingsPageView
        displayName={persistedDisplayName}
        email={session.user.email}
        imageUrl={imageUrl}
        profileImageBusy={
          uploadProfileImageMutation.isPending || deleteProfileImageMutation.isPending
        }
        profileImageErrorMessage={profileImageErrorMessage}
        onDeleteProfileImage={async () => {
          await deleteProfileImageMutation.mutateAsync();
        }}
        onSaveChanges={async (displayNameDraft) => {
          await saveMutation.mutateAsync(displayNameDraft.trim());
        }}
        onUploadProfileImage={async (file) => {
          await uploadProfileImageMutation.mutateAsync(file);
        }}
        saving={saveMutation.isPending}
      />
    </FormPageFrame>
  );
}
