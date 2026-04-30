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
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import {
  createOrganizationLogoContentPath,
  createSingletonImageContentUrl,
} from "../shared/singleton-image.js";
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
  activeOrganizationId: string,
): readonly ["settings", "organization-general", string] {
  return [
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[0],
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[1],
    activeOrganizationId,
  ];
}

export function OrganizationGeneralSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const activeOrganizationId = useRequiredOrganizationId();
  const [organizationLogoOperationErrorMessage, setOrganizationLogoOperationErrorMessage] =
    useState<string | null>(null);
  const { title, description } = resolvePageFrameText(pageMeta, "General");

  const organizationQuery = useQuery({
    queryKey: settingsOrganizationGeneralQueryKey(activeOrganizationId),
    queryFn: async () =>
      getOrganizationGeneral({
        organizationId: activeOrganizationId,
      }),
  });
  const organizationLogoQuery = useOrganizationLogoQuery(activeOrganizationId);

  const saveMutation = useMutation({
    mutationFn: async (nextState: OrganizationFormState) => {
      const currentOrganization = organizationQuery.data;
      if (currentOrganization === undefined) {
        throw new Error("Organization settings data is required.");
      }

      return updateOrganizationGeneral({
        organizationId: activeOrganizationId,
        name: nextState.name,
        slug: currentOrganization.slug,
      });
    },
    onSuccess: async (_result, variables) => {
      const currentOrganization = organizationQuery.data;
      if (currentOrganization === undefined) {
        throw new Error("Organization settings data is required.");
      }

      queryClient.setQueryData(organizationSummaryQueryKey(activeOrganizationId), {
        name: variables.name,
        slug: currentOrganization.slug,
      });

      const refetched = await organizationQuery.refetch();
      const latest = refetched.data;
      if (latest) {
        queryClient.setQueryData(organizationSummaryQueryKey(activeOrganizationId), {
          name: latest.name,
          slug: latest.slug,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: organizationSummaryQueryKey(activeOrganizationId),
      });
    },
  });
  const uploadOrganizationLogoMutation = useMutation({
    mutationFn: async (file: File) => uploadOrganizationLogo({ file }),
    onMutate: async () => {
      setOrganizationLogoOperationErrorMessage(null);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(organizationLogoQueryKey(activeOrganizationId), result);
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
    mutationFn: async () => deleteOrganizationLogo(),
    onMutate: async () => {
      setOrganizationLogoOperationErrorMessage(null);
    },
    onSuccess: async () => {
      queryClient.setQueryData(organizationLogoQueryKey(activeOrganizationId), {
        hasImage: false,
        imageVersion: null,
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

  if (organizationQuery.isPending) {
    return (
      <PageFrame width="form" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  return (
    <PageFrame width="form" description={description} title={title}>
      <OrganizationGeneralSettingsPageView
        key={`${activeOrganizationId}:${organizationQuery.data?.slug ?? "unknown"}`}
        isSaving={saveMutation.isPending}
        logoBusy={
          uploadOrganizationLogoMutation.isPending || deleteOrganizationLogoMutation.isPending
        }
        logoErrorMessage={logoErrorMessage}
        logoUrl={createSingletonImageContentUrl({
          resourceName: "Organization logo",
          path: createOrganizationLogoContentPath(activeOrganizationId),
          image: organizationLogoQuery.data,
        })}
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
    </PageFrame>
  );
}
