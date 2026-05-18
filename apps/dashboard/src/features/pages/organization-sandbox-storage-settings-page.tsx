import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { data } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  getMembershipCapabilities,
  membershipCapabilitiesQueryKey,
} from "../settings/members/members-capabilities-service.js";
import {
  createOrganizationSandboxStorageFormState,
  createOrganizationSandboxStorageUpdatePayload,
  canManageOrganizationSandboxStorage,
  type OrganizationSandboxStorageFormErrors,
  type OrganizationSandboxStorageFormState,
  validateOrganizationSandboxStorageFormState,
} from "../settings/organization/sandbox-storage-model.js";
import {
  getOrganizationSandboxStorageSettings,
  organizationSandboxStorageSettingsQueryKey,
  updateOrganizationSandboxStorageSettings,
} from "../settings/organization/sandbox-storage-service.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationSandboxStorageSettingsPageView } from "./organization-sandbox-storage-settings-page-view.js";

export function OrganizationSandboxStorageSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const activeOrganizationId = useRequiredOrganizationId();
  const { title, description } = resolvePageFrameText(pageMeta, "Sandboxes");
  const [draftState, setDraftState] = useState<OrganizationSandboxStorageFormState | null>(null);
  const [savedState, setSavedState] = useState<OrganizationSandboxStorageFormState | null>(null);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(activeOrganizationId),
    queryFn: async () => getMembershipCapabilities(),
  });

  const organizationSandboxStorageSettingsQuery = useQuery({
    enabled:
      membershipCapabilitiesQuery.data !== undefined &&
      canManageOrganizationSandboxStorage({
        actorRole: membershipCapabilitiesQuery.data.actorRole,
      }),
    queryKey: organizationSandboxStorageSettingsQueryKey(activeOrganizationId),
    queryFn: async () => getOrganizationSandboxStorageSettings(),
  });

  const saveMutation = useMutation({
    mutationFn: async (nextState: OrganizationSandboxStorageFormState) =>
      updateOrganizationSandboxStorageSettings({
        payload: createOrganizationSandboxStorageUpdatePayload(nextState),
      }),
    onSuccess: async (response) => {
      const nextSavedState = createOrganizationSandboxStorageFormState(response);
      setDraftState(nextSavedState);
      setSavedState(nextSavedState);
      setHasAttemptedSave(false);
      setSaveErrorMessage(null);
      queryClient.setQueryData(
        organizationSandboxStorageSettingsQueryKey(activeOrganizationId),
        response,
      );
      await queryClient.invalidateQueries({
        queryKey: organizationSandboxStorageSettingsQueryKey(activeOrganizationId),
      });
    },
    onError: (error) => {
      setSaveErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save sandbox storage settings.",
        }),
      );
    },
  });

  useEffect(() => {
    if (organizationSandboxStorageSettingsQuery.data === undefined) {
      return;
    }

    const nextSavedState = createOrganizationSandboxStorageFormState(
      organizationSandboxStorageSettingsQuery.data,
    );
    setDraftState(nextSavedState);
    setSavedState(nextSavedState);
    setHasAttemptedSave(false);
    setSaveErrorMessage(null);
  }, [organizationSandboxStorageSettingsQuery.data]);

  if (membershipCapabilitiesQuery.isPending) {
    return (
      <PageFrame width="form" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  if (membershipCapabilitiesQuery.isError) {
    throw membershipCapabilitiesQuery.error;
  }

  if (
    !canManageOrganizationSandboxStorage({
      actorRole: membershipCapabilitiesQuery.data.actorRole,
    })
  ) {
    throw data(
      {
        message: "Only organization owners and admins can view sandbox storage settings.",
      },
      { status: 403 },
    );
  }

  const resolvedDraftState = draftState ?? createEmptyOrganizationSandboxStorageFormState();
  const resolvedSavedState = savedState ?? resolvedDraftState;
  const visibleErrors: OrganizationSandboxStorageFormErrors = hasAttemptedSave
    ? validateOrganizationSandboxStorageFormState(resolvedDraftState)
    : {};

  if (
    organizationSandboxStorageSettingsQuery.isPending ||
    (draftState === null && !organizationSandboxStorageSettingsQuery.isError)
  ) {
    return (
      <PageFrame width="form" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  return (
    <PageFrame width="form" description={description} title={title}>
      <OrganizationSandboxStorageSettingsPageView
        isSaving={saveMutation.isPending}
        loadErrorMessage={
          organizationSandboxStorageSettingsQuery.isError
            ? resolveApiErrorMessage({
                error: organizationSandboxStorageSettingsQuery.error,
                fallbackMessage: "Could not load sandbox storage settings.",
              })
            : null
        }
        onPersistentSandboxesEnabledChange={async (enabled) => {
          const nextState: OrganizationSandboxStorageFormState = {
            ...resolvedDraftState,
            persistentSandboxesEnabled: enabled,
          };
          const nextErrors = validateOrganizationSandboxStorageFormState(nextState);
          setDraftState(nextState);
          setHasAttemptedSave(true);
          setSaveErrorMessage(null);
          if (Object.keys(nextErrors).length > 0) {
            return;
          }

          try {
            await saveMutation.mutateAsync(nextState);
          } catch {
            setDraftState(resolvedSavedState);
          }
        }}
        onStateChange={(nextState) => {
          setDraftState(nextState);
          setSaveErrorMessage(null);
        }}
        saveErrorMessage={saveErrorMessage}
        state={resolvedDraftState}
        visibleErrors={visibleErrors}
      />
    </PageFrame>
  );
}

function createEmptyOrganizationSandboxStorageFormState(): OrganizationSandboxStorageFormState {
  return {
    persistentSandboxesEnabled: false,
    storageConfigSource: "managed",
    region: "",
    namePrefix: "",
    apiKey: "",
    apiKeyConfigured: false,
    bucket: "",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    secretAccessKeyConfigured: false,
  };
}
