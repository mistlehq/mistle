import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  organizationLogoQueryKey,
  useOrganizationLogoQuery,
} from "../organizations/organization-logo-query.js";
import {
  getOrganizationGeneral,
  updateOrganizationGeneral,
} from "../settings/organization/organization-general-service.js";
import {
  deleteOrganizationLogo,
  uploadOrganizationLogo,
} from "../settings/organization/organization-logo-service.js";
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
  const [organizationLogoOperationErrorMessage, setOrganizationLogoOperationErrorMessage] =
    useState<string | null>(null);
  const { title, description } = resolvePageFrameText(pageMeta, "General");

  const organizationQuery = useQuery({
    queryKey: settingsOrganizationGeneralQueryKey(organizationId),
    queryFn: async () =>
      getOrganizationGeneral({
        organizationId,
      }),
  });
  const organizationLogoQuery = useOrganizationLogoQuery(organizationId);

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
  const uploadOrganizationLogoMutation = useMutation({
    mutationFn: async (file: File) =>
      uploadOrganizationLogo({
        organizationId,
        file,
      }),
    onMutate: async () => {
      setOrganizationLogoOperationErrorMessage(null);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(organizationLogoQueryKey(organizationId), {
        imageUrl: result.imageUrl,
      });
      setOrganizationLogoOperationErrorMessage(null);
    },
    onError: (error) => {
      setOrganizationLogoOperationErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Upload failed. Please try again later.",
        }),
      );
    },
  });
  const deleteOrganizationLogoMutation = useMutation({
    mutationFn: async () =>
      deleteOrganizationLogo({
        organizationId,
      }),
    onMutate: async () => {
      setOrganizationLogoOperationErrorMessage(null);
    },
    onSuccess: async () => {
      queryClient.setQueryData(organizationLogoQueryKey(organizationId), {
        imageUrl: null,
      });
      setOrganizationLogoOperationErrorMessage(null);
    },
    onError: (error) => {
      setOrganizationLogoOperationErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Remove failed. Please try again later.",
        }),
      );
    },
  });

  const logoErrorMessage =
    organizationLogoOperationErrorMessage ??
    (organizationLogoQuery.isError
      ? resolveApiErrorMessage({
          error: organizationLogoQuery.error,
          fallbackMessage: "Could not load organization logo.",
        })
      : null);

  return (
    <FormPageFrame description={description} title={title}>
      <OrganizationGeneralSettingsPageView
        key={
          organizationQuery.data === undefined
            ? `loading:${organizationId}`
            : `${organizationId}:${organizationQuery.data.slug}`
        }
        isLoading={organizationQuery.isPending}
        isSaving={saveMutation.isPending}
        logoBusy={
          uploadOrganizationLogoMutation.isPending || deleteOrganizationLogoMutation.isPending
        }
        logoErrorMessage={logoErrorMessage}
        logoUrl={organizationLogoQuery.data?.imageUrl ?? null}
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
          await saveMutation.mutateAsync({
            name: name.trim(),
          });
        }}
        onDeleteLogo={async () => {
          await deleteOrganizationLogoMutation.mutateAsync();
        }}
        onUploadLogo={async (file) => {
          await uploadOrganizationLogoMutation.mutateAsync(file);
        }}
      />
    </FormPageFrame>
  );
}
