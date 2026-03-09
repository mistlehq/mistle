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

  const [formState, setFormState] = useState<OrganizationFormState>({
    name: "",
  });
  const [persistedFormState, setPersistedFormState] = useState<OrganizationFormState>({
    name: "",
  });
  const [persistedSlug, setPersistedSlug] = useState("");
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
    if (!organizationQuery.data) {
      return;
    }

    const loadedState = {
      name: organizationQuery.data.name,
    };
    setFormState(loadedState);
    setPersistedFormState(loadedState);
    setPersistedSlug(organizationQuery.data.slug);
  }, [organizationQuery.data]);

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
    mutationFn: async (nextState: OrganizationFormState) =>
      updateOrganizationGeneral({
        organizationId,
        name: nextState.name,
        slug: persistedSlug,
      }),
    onSuccess: async (_result, variables) => {
      queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
        name: variables.name,
        slug: persistedSlug,
      });

      const refetched = await organizationQuery.refetch();
      const latest = refetched.data;
      if (latest) {
        const latestState = {
          name: latest.name,
        };
        setFormState(latestState);
        setPersistedFormState(latestState);
        setPersistedSlug(latest.slug);
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

  const normalizedName = formState.name.trim();
  const hasDirtyChanges = normalizedName !== persistedFormState.name.trim();
  const hasNameError = normalizedName.length === 0;

  function handleNameChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      name: nextValue,
    }));
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  function handleCancelChanges(): void {
    setFormState(persistedFormState);
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  async function saveChanges(): Promise<void> {
    await saveMutation.mutateAsync({
      name: normalizedName,
    });
  }

  function handleSaveChanges(): void {
    void saveChanges();
  }

  return (
    <OrganizationGeneralSettingsPageView
      hasDirtyChanges={hasDirtyChanges}
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
      name={formState.name}
      nameErrorMessage={hasNameError ? "Organization name is required." : null}
      onCancelChanges={handleCancelChanges}
      onNameChange={handleNameChange}
      onRetryLoad={() => {
        void organizationQuery.refetch();
      }}
      onSaveChanges={handleSaveChanges}
      saveErrorMessage={saveError}
      saveSuccess={showSaveSuccess}
    />
  );
}
