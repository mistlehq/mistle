import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  clearLinkedAccountCallbackSearchParams,
  findLinkedAccount,
  resolveLinkedAccountCallbackNotice,
  resolveLinkedAccountCardViewModel,
  type LinkedAccountCallbackNotice,
} from "../settings/identity-linking/linked-accounts-model.js";
import {
  linkedAccountsQueryKey,
  listLinkedAccounts,
  startLinkedAccountAuthorization,
  unlinkLinkedAccount,
} from "../settings/identity-linking/linked-accounts-service.js";
import {
  deleteProfileImage,
  getProfileImage,
  updateProfileDisplayName,
  uploadProfileImage,
} from "../settings/profile/profile-service.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import {
  createSingletonImageContentUrl,
  ProfileImageContentPath,
} from "../shared/singleton-image.js";
import { resolveUserDisplayName } from "../shared/user-display-name.js";
import { useRequiredOrganizationId, useRequiredSession } from "../shell/require-auth.js";
import { SESSION_QUERY_KEY } from "../shell/session-query-key.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const PROFILE_IMAGE_QUERY_KEY: readonly ["settings", "profile-image"] = [
  "settings",
  "profile-image",
];

export function ProfileSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const session = useRequiredSession();
  const activeOrganizationId = useRequiredOrganizationId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profileImageOperationErrorMessage, setProfileImageOperationErrorMessage] = useState<
    string | null
  >(null);
  const [linkedAccountOperationErrorMessage, setLinkedAccountOperationErrorMessage] = useState<
    string | null
  >(null);
  const [callbackNotice, setCallbackNotice] = useState<LinkedAccountCallbackNotice | null>(null);
  const { title, description } = resolvePageFrameText(pageMeta, "Profile");
  const profileImageQuery = useQuery({
    queryKey: PROFILE_IMAGE_QUERY_KEY,
    queryFn: getProfileImage,
    staleTime: 15 * 60 * 1000,
  });
  const linkedAccountsQuery = useQuery({
    queryKey: linkedAccountsQueryKey(activeOrganizationId),
    queryFn: async ({ signal }) => listLinkedAccounts({ signal }),
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
      queryClient.setQueryData(PROFILE_IMAGE_QUERY_KEY, result);
      await queryClient.invalidateQueries({
        queryKey: ["settings", "members-directory"],
      });
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
        hasImage: false,
        imageVersion: null,
      });
      await queryClient.invalidateQueries({
        queryKey: ["settings", "members-directory"],
      });
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
  const startLinkedAccountAuthorizationMutation = useMutation({
    mutationFn: async (providerFamily: string) =>
      startLinkedAccountAuthorization({ providerFamily }),
    onMutate: async () => {
      setLinkedAccountOperationErrorMessage(null);
    },
    onSuccess: (result) => {
      globalThis.location.assign(result.authorizationUrl);
    },
    onError: (error) => {
      setLinkedAccountOperationErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not start linked account authorization.",
        }),
      );
    },
  });
  const unlinkLinkedAccountMutation = useMutation({
    mutationFn: async (providerFamily: string) => unlinkLinkedAccount({ providerFamily }),
    onMutate: async () => {
      setLinkedAccountOperationErrorMessage(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: linkedAccountsQueryKey(activeOrganizationId),
      });
    },
    onError: (error) => {
      setLinkedAccountOperationErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not unlink linked account.",
        }),
      );
    },
  });

  useEffect(() => {
    const resolvedNotice = resolveLinkedAccountCallbackNotice({
      providerFamily: searchParams.get("linkedAccountProvider"),
      result: searchParams.get("linkedAccountResult"),
      code: searchParams.get("linkedAccountCode"),
    });

    if (resolvedNotice === null) {
      return;
    }

    setCallbackNotice(resolvedNotice);
    setSearchParams(clearLinkedAccountCallbackSearchParams(searchParams), { replace: true });
  }, [searchParams, setSearchParams]);

  const persistedDisplayName = resolveUserDisplayName(session.user);
  const imageUrl = createSingletonImageContentUrl({
    resourceName: "Profile image",
    path: ProfileImageContentPath,
    image: profileImageQuery.data,
  });
  const profileImageErrorMessage =
    profileImageOperationErrorMessage ??
    (profileImageQuery.isError
      ? resolveApiErrorMessage({
          error: profileImageQuery.error,
          fallbackMessage: "Could not load profile image.",
        })
      : null);
  const githubLinkedAccount =
    linkedAccountsQuery.data === undefined
      ? null
      : findLinkedAccount({
          linkedAccounts: linkedAccountsQuery.data,
          providerFamily: "github",
        });
  const githubLinkedAccountCard =
    githubLinkedAccount === null || githubLinkedAccount.configurationStatus === "disabled"
      ? null
      : resolveLinkedAccountCardViewModel(githubLinkedAccount);
  const linkedAccountsLoadErrorMessage = linkedAccountsQuery.isError
    ? resolveApiErrorMessage({
        error: linkedAccountsQuery.error,
        fallbackMessage: "Could not load linked accounts.",
      })
    : null;
  const linkedAccountsEmptyStateMessage =
    linkedAccountsQuery.data !== undefined &&
    linkedAccountsLoadErrorMessage === null &&
    githubLinkedAccountCard === null
      ? "Your organization has not enabled any linked account providers right now."
      : null;

  return (
    <FormPageFrame description={description} title={title}>
      <ProfileSettingsPageView
        displayName={persistedDisplayName}
        email={session.user.email}
        imageUrl={imageUrl}
        linkedAccountCallbackNotice={callbackNotice}
        linkedAccountCard={githubLinkedAccountCard}
        linkedAccountErrorMessage={linkedAccountOperationErrorMessage}
        linkedAccountsEmptyStateMessage={linkedAccountsEmptyStateMessage}
        linkedAccountsLoading={linkedAccountsQuery.isPending}
        linkedAccountsLoadErrorMessage={linkedAccountsLoadErrorMessage}
        profileImageBusy={
          uploadProfileImageMutation.isPending || deleteProfileImageMutation.isPending
        }
        profileImageErrorMessage={profileImageErrorMessage}
        onDeleteProfileImage={async () => {
          await deleteProfileImageMutation.mutateAsync();
        }}
        onLinkLinkedAccount={async (providerFamily) => {
          await startLinkedAccountAuthorizationMutation.mutateAsync(providerFamily);
        }}
        onSaveChanges={async (displayNameDraft) => {
          await saveMutation.mutateAsync(displayNameDraft.trim());
        }}
        onUnlinkLinkedAccount={async (providerFamily) => {
          await unlinkLinkedAccountMutation.mutateAsync(providerFamily);
        }}
        onUploadProfileImage={async (file) => {
          await uploadProfileImageMutation.mutateAsync(file);
        }}
        linkedAccountActionPending={
          startLinkedAccountAuthorizationMutation.isPending || unlinkLinkedAccountMutation.isPending
        }
        saving={saveMutation.isPending}
      />
    </FormPageFrame>
  );
}
