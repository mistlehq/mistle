import { toast } from "@mistle/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { data, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  canManageOrganizationIdentityLinking,
  formatIdentityLinkEligibleConnectionLabel,
  formatIdentityLinkProviderMemberStatus,
  formatIdentityLinkProviderPrincipalSummary,
  listEligibleIdentityLinkConnections,
  resolveReturnedIdentityLinkConnectionSelection,
} from "../settings/identity-linking/organization-identity-linking-model.js";
import {
  configureOrganizationIdentityLinkProvider,
  listOrganizationIdentityLinkProviderLinks,
  listOrganizationIdentityLinkProviders,
  organizationIdentityLinkProviderLinksQueryKey,
  organizationIdentityLinkProvidersQueryKey,
  type OrganizationIdentityLinkProviderLink,
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
  type OrganizationIdentityLinkingProviderRow,
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
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
        }),
      ]);
    },
    onError: (error) => {
      toast.error(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save identity-linking provider configuration.",
        }),
      );
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
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
      });
    },
    onError: (error) => {
      toast.error(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update identity-linking provider status.",
        }),
      );
    },
    onSettled: () => {
      setStatusUpdatingProviderFamily(null);
    },
  });

  const providers = providersQuery.data ?? [];
  const providerLinksQueries = useQueries({
    queries: providers.map((provider) => ({
      enabled: canManage && !providersQuery.isPending,
      queryKey: organizationIdentityLinkProviderLinksQueryKey({
        activeOrganizationId,
        providerFamily: provider.providerFamily,
      }),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        listOrganizationIdentityLinkProviderLinks({
          providerFamily: provider.providerFamily,
          signal,
        }),
    })),
  });
  const providerLinksByProviderFamily = new Map<
    string,
    {
      data: readonly OrganizationIdentityLinkProviderLink[] | undefined;
      isPending: boolean;
      isError: boolean;
      error: unknown;
    }
  >(
    providers.map((provider, index) => [
      provider.providerFamily,
      {
        data: providerLinksQueries[index]?.data,
        isPending: providerLinksQueries[index]?.isPending ?? false,
        isError: providerLinksQueries[index]?.isError ?? false,
        error: providerLinksQueries[index]?.error,
      },
    ]),
  );
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

  if (membershipCapabilitiesQuery.isPending || (canManage && providersQuery.isPending)) {
    return (
      <PageFrame description={description} width="normal" title={title}>
        {null}
      </PageFrame>
    );
  }

  return (
    <PageFrame description={description} width="normal" title={title}>
      <OrganizationIdentityLinkingSettingsPageView
        loadErrorMessage={resolveLoadErrorMessage({
          canManage,
          providersError: providersQuery.isError ? providersQuery.error : null,
        })}
        onEnabledChange={async ({ providerFamily, enabled }) => {
          await statusMutation.mutateAsync({
            providerFamily,
            status: enabled ? "active" : "disabled",
          });
        }}
        onProviderConnectionChange={async ({ providerFamily, integrationConnectionId }) => {
          const previousDisplayedConnectionId = resolveProviderDisplayedConnectionId({
            provider:
              providers.find((candidate) => candidate.providerFamily === providerFamily) ?? null,
            selectedConnectionIdByProviderFamily,
          });

          setSelectedConnectionIdByProviderFamily((current) => ({
            ...current,
            [providerFamily]: integrationConnectionId,
          }));

          try {
            await configureMutation.mutateAsync({
              providerFamily,
              integrationConnectionId,
            });
          } catch (error) {
            setSelectedConnectionIdByProviderFamily((current) =>
              restoreSelectedConnectionDraft({
                current,
                providerFamily,
                selectedConnectionId: previousDisplayedConnectionId,
              }),
            );

            throw error;
          }
        }}
        providers={providers.map((provider) =>
          buildProviderRow({
            configuringProviderFamily,
            statusUpdatingProviderFamily,
            provider,
            providerLinksQuery: providerLinksByProviderFamily.get(provider.providerFamily) ?? null,
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

export function buildProviderRow(input: {
  configuringProviderFamily: string | null;
  statusUpdatingProviderFamily: string | null;
  provider: OrganizationIdentityLinkProvider;
  providerLinksQuery: {
    data: readonly OrganizationIdentityLinkProviderLink[] | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  } | null;
  selectedConnectionIdByProviderFamily: Readonly<Record<string, string | undefined>>;
}): OrganizationIdentityLinkingProviderRow {
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
  return {
    providerFamily: input.provider.providerFamily,
    displayName: input.provider.displayName,
    logoKey: input.provider.logoKey,
    connectionOptions: eligibleConnections.map((connection) => ({
      id: connection.id,
      label: formatIdentityLinkEligibleConnectionLabel(connection),
    })),
    selectedConnectionId,
    connectionPending: input.configuringProviderFamily === input.provider.providerFamily,
    enablePending: input.statusUpdatingProviderFamily === input.provider.providerFamily,
    enabled: input.provider.configurationStatus === "active",
    linkedUsersCount: input.providerLinksQuery?.data?.length ?? 0,
    memberLinksLoading: input.providerLinksQuery?.isPending ?? false,
    memberLinksErrorMessage:
      input.providerLinksQuery !== null && input.providerLinksQuery.isError
        ? resolveApiErrorMessage({
            error: input.providerLinksQuery.error,
            fallbackMessage: "Could not load linked-member visibility.",
          })
        : null,
    memberLinks:
      input.providerLinksQuery?.data?.map((link) => ({
        userId: link.userId,
        name: link.name,
        email: link.email,
        statusLabel: formatIdentityLinkProviderMemberStatus({
          linked: link.linked,
        }),
        principalSummary: formatIdentityLinkProviderPrincipalSummary({
          link,
        }),
        updatedAt: link.updatedAt,
      })) ?? [],
  };
}

function resolveProviderDisplayedConnectionId(input: {
  provider: OrganizationIdentityLinkProvider | null;
  selectedConnectionIdByProviderFamily: Readonly<Record<string, string | undefined>>;
}): string | null {
  if (input.provider === null) {
    return null;
  }

  const eligibleConnections = listEligibleIdentityLinkConnections({
    provider: input.provider,
  });

  return resolveSelectedConnectionId({
    draftSelectedConnectionId:
      input.selectedConnectionIdByProviderFamily[input.provider.providerFamily],
    eligibleConnections,
    selectedConnectionId: input.provider.selectedConnection?.id ?? null,
  });
}

function restoreSelectedConnectionDraft(input: {
  current: Readonly<Record<string, string | undefined>>;
  providerFamily: string;
  selectedConnectionId: string | null;
}): Readonly<Record<string, string | undefined>> {
  if (input.selectedConnectionId === null) {
    const next = { ...input.current };
    delete next[input.providerFamily];
    return next;
  }

  return {
    ...input.current,
    [input.providerFamily]: input.selectedConnectionId,
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
