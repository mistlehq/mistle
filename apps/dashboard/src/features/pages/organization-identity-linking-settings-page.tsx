import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { data, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  canManageOrganizationIdentityLinking,
  formatIdentityLinkEligibleConnectionLabel,
  formatIdentityLinkProviderConfigurationStatus,
  listEligibleIdentityLinkConnections,
  resolveIdentityLinkConfigureActionLabel,
  resolveReturnedIdentityLinkConnectionSelection,
  resolveIdentityLinkStatusActionLabel,
} from "../settings/identity-linking/organization-identity-linking-model.js";
import {
  configureOrganizationIdentityLinkProvider,
  listOrganizationIdentityLinkProviders,
  organizationIdentityLinkProvidersQueryKey,
  putOrganizationIdentityLinkProviderStatus,
  type OrganizationIdentityLinkProvider,
} from "../settings/identity-linking/organization-identity-linking-service.js";
import {
  getMembershipCapabilities,
  membershipCapabilitiesQueryKey,
} from "../settings/members/members-capabilities-service.js";
import { resolvePageFrameText, PageFrame } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import {
  type OrganizationIdentityLinkingProviderCard,
  OrganizationIdentityLinkingSettingsPageView,
} from "./organization-identity-linking-settings-page-view.js";

export function OrganizationIdentityLinkingSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const activeOrganizationId = useRequiredOrganizationId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Identity Linking");
  const [selectedConnectionIdByProviderFamily, setSelectedConnectionIdByProviderFamily] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [actionErrorMessageByProviderFamily, setActionErrorMessageByProviderFamily] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [configuringProviderFamily, setConfiguringProviderFamily] = useState<string | null>(null);
  const [statusUpdatingProviderFamily, setStatusUpdatingProviderFamily] = useState<string | null>(
    null,
  );

  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(),
    queryFn: async () => getMembershipCapabilities(),
  });

  const canManage =
    membershipCapabilitiesQuery.data === undefined
      ? true
      : canManageOrganizationIdentityLinking({
          actorRole: membershipCapabilitiesQuery.data.actorRole,
        });

  const providersQuery = useQuery({
    enabled: canManage && !membershipCapabilitiesQuery.isPending,
    queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
    queryFn: async ({ signal }) => listOrganizationIdentityLinkProviders({ signal }),
  });

  const configureMutation = useMutation({
    mutationFn: async (input: { providerFamily: string; integrationConnectionId: string }) =>
      configureOrganizationIdentityLinkProvider(input),
    onMutate: async (input) => {
      setConfiguringProviderFamily(input.providerFamily);
      setActionErrorMessageByProviderFamily((current) => ({
        ...current,
        [input.providerFamily]: undefined,
      }));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
        }),
      ]);
    },
    onError: (error, input) => {
      setActionErrorMessageByProviderFamily((current) => ({
        ...current,
        [input.providerFamily]: resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save identity-linking provider configuration.",
        }),
      }));
    },
    onSettled: () => {
      setConfiguringProviderFamily(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (input: { providerFamily: string; status: "active" | "disabled" }) =>
      putOrganizationIdentityLinkProviderStatus(input),
    onMutate: async (input) => {
      setStatusUpdatingProviderFamily(input.providerFamily);
      setActionErrorMessageByProviderFamily((current) => ({
        ...current,
        [input.providerFamily]: undefined,
      }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
      });
    },
    onError: (error, input) => {
      setActionErrorMessageByProviderFamily((current) => ({
        ...current,
        [input.providerFamily]: resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update identity-linking provider status.",
        }),
      }));
    },
    onSettled: () => {
      setStatusUpdatingProviderFamily(null);
    },
  });

  const providers = providersQuery.data ?? [];
  const createdConnectionId = searchParams.get("createdConnectionId");

  useEffect(() => {
    if (createdConnectionId === null) {
      return;
    }

    if (providersQuery.data === undefined) {
      return;
    }

    if (createdConnectionId !== null) {
      const selection = resolveReturnedIdentityLinkConnectionSelection({
        connectionId: createdConnectionId,
        providers: providersQuery.data,
      });

      if (selection !== null) {
        setSelectedConnectionIdByProviderFamily((current) => ({
          ...current,
          [selection.providerFamily]: selection.integrationConnectionId,
        }));
      }
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("createdConnectionId");
    setSearchParams(nextSearchParams, { replace: true });
  }, [createdConnectionId, providersQuery.data, searchParams, setSearchParams]);

  if (membershipCapabilitiesQuery.isError) {
    throw membershipCapabilitiesQuery.error;
  }

  if (
    membershipCapabilitiesQuery.data !== undefined &&
    !canManageOrganizationIdentityLinking({
      actorRole: membershipCapabilitiesQuery.data.actorRole,
    })
  ) {
    throw data(
      {
        message: "Only organization owners and admins can view Identity Linking settings.",
      },
      { status: 403 },
    );
  }

  return (
    <PageFrame description={description} maxWidthClassName="max-w-5xl" title={title}>
      <OrganizationIdentityLinkingSettingsPageView
        isLoading={membershipCapabilitiesQuery.isPending || (canManage && providersQuery.isPending)}
        loadErrorMessage={resolveLoadErrorMessage({
          canManage,
          providersError: providersQuery.isError ? providersQuery.error : null,
        })}
        onStatusAction={async ({ providerFamily, status }) => {
          await statusMutation.mutateAsync({
            providerFamily,
            status,
          });
        }}
        onProviderConnectionChange={({ providerFamily, integrationConnectionId }) => {
          setSelectedConnectionIdByProviderFamily((current) => ({
            ...current,
            [providerFamily]: integrationConnectionId,
          }));
        }}
        onSaveProvider={async ({ providerFamily, integrationConnectionId }) => {
          await configureMutation.mutateAsync({
            providerFamily,
            integrationConnectionId,
          });
        }}
        providers={providers.map((provider) =>
          buildProviderCard({
            actionErrorMessageByProviderFamily,
            configuringProviderFamily,
            statusUpdatingProviderFamily,
            provider,
            selectedConnectionIdByProviderFamily,
          }),
        )}
      />
    </PageFrame>
  );
}

function resolveLoadErrorMessage(input: {
  canManage: boolean;
  providersError: unknown;
}): string | null {
  if (!input.canManage) {
    return null;
  }

  if (input.providersError !== null) {
    return resolveApiErrorMessage({
      error: input.providersError,
      fallbackMessage: "Could not load identity-linking providers.",
    });
  }

  return null;
}

export function buildProviderCard(input: {
  actionErrorMessageByProviderFamily: Readonly<Record<string, string | undefined>>;
  configuringProviderFamily: string | null;
  statusUpdatingProviderFamily: string | null;
  provider: OrganizationIdentityLinkProvider;
  selectedConnectionIdByProviderFamily: Readonly<Record<string, string | undefined>>;
}): OrganizationIdentityLinkingProviderCard {
  const eligibleConnections = listEligibleIdentityLinkConnections({
    provider: input.provider,
  });
  const draftSelectedConnectionId =
    input.selectedConnectionIdByProviderFamily[input.provider.providerFamily];
  const selectedConnectionId = resolveSelectedConnectionId({
    draftSelectedConnectionId,
    eligibleConnections,
    selectedConnectionId: input.provider.selectedConnection?.id ?? null,
  });
  const hasUnsavedConnectionSelection =
    input.provider.selectedConnection !== null &&
    selectedConnectionId !== null &&
    selectedConnectionId !== input.provider.selectedConnection.id;

  const baseCard: Omit<OrganizationIdentityLinkingProviderCard, "errorMessage"> = {
    providerFamily: input.provider.providerFamily,
    displayName: input.provider.displayName,
    logoKey: input.provider.logoKey,
    configurationStatusLabel: formatIdentityLinkProviderConfigurationStatus({
      configurationStatus: input.provider.configurationStatus,
    }),
    configurationStatusTone: input.provider.configurationStatus,
    eligibleConnections: eligibleConnections.map((connection) => ({
      id: connection.id,
      label: formatIdentityLinkEligibleConnectionLabel(connection),
    })),
    selectedConnectionId,
    configureActionLabel: resolveIdentityLinkConfigureActionLabel(),
    statusActionLabel: resolveIdentityLinkStatusActionLabel({
      configurationStatus: input.provider.configurationStatus,
    }),
    addConnectionOptions: createIdentityLinkAddConnectionOptions({
      eligibleTargetKeys: input.provider.eligibleTargetKeys,
    }),
    statusActionVisible:
      input.provider.selectedConnection !== null && !hasUnsavedConnectionSelection,
    statusActionDisabled: input.statusUpdatingProviderFamily === input.provider.providerFamily,
    saveActionDisabled: selectedConnectionId === null,
    saveActionPending: input.configuringProviderFamily === input.provider.providerFamily,
    statusActionPending: input.statusUpdatingProviderFamily === input.provider.providerFamily,
    statusActionNextStatus: input.provider.configurationStatus === "active" ? "disabled" : "active",
  };

  const errorMessage = input.actionErrorMessageByProviderFamily[input.provider.providerFamily];
  if (errorMessage === undefined) {
    return baseCard;
  }

  return {
    ...baseCard,
    errorMessage,
  };
}

function resolveSelectedConnectionId(input: {
  draftSelectedConnectionId: string | undefined;
  eligibleConnections: readonly {
    id: string;
  }[];
  selectedConnectionId: string | null;
}): string | null {
  if (
    input.draftSelectedConnectionId !== undefined &&
    input.eligibleConnections.some(
      (connection) => connection.id === input.draftSelectedConnectionId,
    )
  ) {
    return input.draftSelectedConnectionId;
  }

  if (
    input.selectedConnectionId !== null &&
    input.eligibleConnections.some((connection) => connection.id === input.selectedConnectionId)
  ) {
    return input.selectedConnectionId;
  }

  return input.eligibleConnections[0]?.id ?? null;
}

function createIdentityLinkAddConnectionOptions(input: {
  eligibleTargetKeys: readonly string[];
}): readonly {
  href: string;
  label: string;
}[] {
  if (input.eligibleTargetKeys.length === 0) {
    throw new Error("Identity-linking provider is missing an eligible target key.");
  }

  const searchParams = new URLSearchParams({
    returnTo: "/settings/organization/identity-linking",
  });

  return input.eligibleTargetKeys.map((targetKey) => ({
    href: `/integrations/${targetKey}/add?${searchParams.toString()}`,
    label: input.eligibleTargetKeys.length === 1 ? "Connect new" : `Connect new (${targetKey})`,
  }));
}
