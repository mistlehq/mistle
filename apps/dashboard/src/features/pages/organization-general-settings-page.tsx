import { useQuery, useQueryClient } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  getOrganizationGeneral,
  updateOrganizationGeneral,
} from "../settings/organization/organization-general-service.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useAutoSaveAction } from "../shared/use-auto-save-action.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

const SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX: readonly [
  "settings",
  "organization-general",
] = ["settings", "organization-general"];

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

  const saveAction = useAutoSaveAction({
    save: async (name: string) => {
      const currentOrganization = organizationQuery.data;
      if (currentOrganization === undefined) {
        throw new Error("Organization settings data is required.");
      }

      await updateOrganizationGeneral({
        organizationId,
        name,
        slug: currentOrganization.slug,
      });
    },
    afterSave: async (name) => {
      const currentOrganization = organizationQuery.data;
      if (currentOrganization === undefined) {
        throw new Error("Organization settings data is required.");
      }

      queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
        name,
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
      <OrganizationGeneralSettingsPageView
        key={
          organizationQuery.data === undefined
            ? `loading:${organizationId}`
            : `${organizationId}:${organizationQuery.data.slug}`
        }
        isLoading={organizationQuery.isPending}
        isSaving={saveAction.isSaving}
        loadErrorMessage={
          organizationQuery.isError
            ? resolveApiErrorMessage({
                error: organizationQuery.error,
                fallbackMessage: "Could not load organization settings.",
              })
            : null
        }
        name={organizationQuery.data?.name ?? ""}
        onSaveChanges={async (name) => {
          try {
            await saveAction.run(name.trim());
          } catch (error) {
            throw new Error(
              resolveApiErrorMessage({
                error,
                fallbackMessage: "Could not update organization settings.",
              }),
            );
          }
        }}
      />
    </FormPageFrame>
  );
}
