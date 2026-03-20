import { systemScheduler } from "@mistle/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  getOrganizationGeneral,
  updateOrganizationGeneral,
} from "../settings/organization/organization-general-service.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

const SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX: readonly [
  "settings",
  "organization-general",
] = ["settings", "organization-general"];

type OrganizationFormState = {
  name: string;
};

function settingsOrganizationGeneralQueryKey(
  organizationId: string,
): readonly ["settings", "organization-general", string] {
  return [
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[0],
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[1],
    organizationId,
  ];
}

export function OrganizationGeneralSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const organizationId = useRequiredOrganizationId();
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const organizationQuery = useQuery({
    queryKey: settingsOrganizationGeneralQueryKey(organizationId),
    queryFn: async () =>
      getOrganizationGeneral({
        organizationId,
      }),
  });

  useEffect(() => {
    if (!showSaveSuccess) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setShowSaveSuccess(false);
    }, 2000);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [showSaveSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (nextState: OrganizationFormState) => {
      const currentOrganization = organizationQuery.data;
      if (currentOrganization === undefined) {
        throw new Error("Organization settings data is required.");
      }

      return updateOrganizationGeneral({
        organizationId,
        name: nextState.name,
        slug: currentOrganization.slug,
      });
    },
    onSuccess: async (_result, variables) => {
      const currentOrganization = organizationQuery.data;
      if (currentOrganization === undefined) {
        throw new Error("Organization settings data is required.");
      }

      queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
        name: variables.name,
        slug: currentOrganization.slug,
      });

      const refetched = await organizationQuery.refetch();
      const latest = refetched.data;
      if (latest) {
        queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
          name: latest.name,
          slug: latest.slug,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: organizationSummaryQueryKey(organizationId),
      });

      setShowSaveSuccess(true);
      setSaveError(null);
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update organization settings.",
        }),
      );
      setShowSaveSuccess(false);
    },
  });

  return (
    <OrganizationGeneralSettingsEditor
      key={
        organizationQuery.data === undefined
          ? "loading"
          : `${organizationQuery.data.slug}:${organizationQuery.data.name}`
      }
      isLoading={organizationQuery.isPending}
      isSaving={saveMutation.isPending}
      loadErrorMessage={
        organizationQuery.isError
          ? resolveApiErrorMessage({
              error: organizationQuery.error,
              fallbackMessage: "Could not load organization settings.",
            })
          : null
      }
      onResetFeedback={() => {
        setSaveError(null);
        setShowSaveSuccess(false);
      }}
      onRetryLoad={() => {
        void organizationQuery.refetch();
      }}
      onSaveChanges={(name) => {
        setSaveError(null);
        setShowSaveSuccess(false);
        void saveMutation.mutateAsync({
          name: name.trim(),
        });
      }}
      organization={organizationQuery.data}
      saveErrorMessage={saveError}
      saveSuccess={showSaveSuccess}
    />
  );
}

function OrganizationGeneralSettingsEditor(input: {
  organization: { name: string; slug: string } | undefined;
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  saveErrorMessage: string | null;
  saveSuccess: boolean;
  onRetryLoad: () => void;
  onSaveChanges: (name: string) => void;
  onResetFeedback: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(input.organization?.name ?? "");
  const normalizedName = name.trim();
  const persistedName = input.organization?.name ?? "";
  const hasDirtyChanges = normalizedName !== persistedName.trim();
  const hasNameError = normalizedName.length === 0;

  return (
    <OrganizationGeneralSettingsPageView
      hasDirtyChanges={hasDirtyChanges}
      isLoading={input.isLoading}
      isSaving={input.isSaving}
      loadErrorMessage={input.loadErrorMessage}
      name={name}
      nameErrorMessage={hasNameError ? "Organization name is required." : null}
      onCancelChanges={() => {
        setName(persistedName);
        input.onResetFeedback();
      }}
      onNameChange={(nextValue) => {
        setName(nextValue);
        input.onResetFeedback();
      }}
      onRetryLoad={input.onRetryLoad}
      onSaveChanges={() => {
        input.onSaveChanges(name);
      }}
      saveErrorMessage={input.saveErrorMessage}
      saveSuccess={input.saveSuccess}
    />
  );
}
