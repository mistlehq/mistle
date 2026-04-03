import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  getOrganizationGeneral,
  updateOrganizationGeneral,
} from "../settings/organization/organization-general-service.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
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
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const organizationId = useRequiredOrganizationId();
  const { title, description } = resolvePageFrameText(pageMeta, "General");

  const organizationQuery = useQuery({
    queryKey: settingsOrganizationGeneralQueryKey(organizationId),
    queryFn: async () =>
      getOrganizationGeneral({
        organizationId,
      }),
  });

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
    },
  });

  return (
    <FormPageFrame description={description} title={title}>
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
        onSaveChanges={async (name) => {
          await saveMutation.mutateAsync({
            name: name.trim(),
          });
        }}
        organization={organizationQuery.data}
      />
    </FormPageFrame>
  );
}

function OrganizationGeneralSettingsEditor(input: {
  organization: { name: string; slug: string } | undefined;
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  onSaveChanges: (name: string) => Promise<void>;
}): React.JSX.Element {
  const [saveError, setSaveError] = useState<string | null>(null);

  return (
    <OrganizationGeneralSettingsPageView
      isLoading={input.isLoading}
      isSaving={input.isSaving}
      loadErrorMessage={input.loadErrorMessage}
      name={input.organization?.name ?? ""}
      onSaveChanges={async (name) => {
        setSaveError(null);

        try {
          await input.onSaveChanges(name);
        } catch (error) {
          setSaveError(
            resolveApiErrorMessage({
              error,
              fallbackMessage: "Could not update organization settings.",
            }),
          );
        }
      }}
      saveError={saveError}
    />
  );
}
