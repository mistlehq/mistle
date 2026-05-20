import { toast } from "@mistle/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  createOrganizationIdentityLinkProviderConfig,
  listOrganizationIdentityLinkProviderLinks,
  listOrganizationIdentityLinkProviders,
  organizationIdentityLinkProviderLinksQueryKey,
  organizationIdentityLinkProvidersQueryKey,
  type OrganizationIdentityLinkProviderConfig,
  type OrganizationIdentityLinkProviderLink,
  putOrganizationIdentityLinkProviderStatus,
  type OrganizationIdentityLinkProvider,
  updateOrganizationIdentityLinkProviderConfig,
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

const DraftConfigIdPrefix = "draft:";

type ProviderConfigRow = {
  rowKey: string;
  provider: OrganizationIdentityLinkProvider;
  config: OrganizationIdentityLinkProviderConfig | null;
};

export function OrganizationIdentityLinkingSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const activeOrganizationId = useRequiredOrganizationId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Identity Linking");
  const [selectedConnectionIdByRowKey, setSelectedConnectionIdByRowKey] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [configuringRowKey, setConfiguringRowKey] = useState<string | null>(null);
  const [statusUpdatingRowKey, setStatusUpdatingRowKey] = useState<string | null>(null);

  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(activeOrganizationId),
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

  const invalidateProviders = async () => {
    await queryClient.invalidateQueries({
      queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
    });
  };

  const createConfigMutation = useMutation({
    mutationFn: async (input: {
      rowKey: string;
      providerFamily: string;
      integrationConnectionId: string;
    }) =>
      createOrganizationIdentityLinkProviderConfig({
        providerFamily: input.providerFamily,
        integrationConnectionId: input.integrationConnectionId,
      }),
    onMutate: async (input) => {
      setConfiguringRowKey(input.rowKey);
    },
    onSuccess: async () => {
      await invalidateProviders();
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
      setConfiguringRowKey(null);
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (input: {
      rowKey: string;
      organizationProviderConfigId: string;
      integrationConnectionId: string;
    }) =>
      updateOrganizationIdentityLinkProviderConfig({
        organizationProviderConfigId: input.organizationProviderConfigId,
        integrationConnectionId: input.integrationConnectionId,
      }),
    onMutate: async (input) => {
      setConfiguringRowKey(input.rowKey);
    },
    onSuccess: async () => {
      await invalidateProviders();
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
      setConfiguringRowKey(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (input: {
      rowKey: string;
      organizationProviderConfigId: string;
      status: "active" | "disabled";
    }) =>
      putOrganizationIdentityLinkProviderStatus({
        organizationProviderConfigId: input.organizationProviderConfigId,
        status: input.status,
      }),
    onMutate: async (input) => {
      setStatusUpdatingRowKey(input.rowKey);
    },
    onSuccess: async () => {
      await invalidateProviders();
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
      setStatusUpdatingRowKey(null);
    },
  });

  const providers = providersQuery.data ?? [];
  const providerConfigRows = useMemo(() => buildProviderConfigRows(providers), [providers]);
  const configuredRows = providerConfigRows.filter((row) => row.config !== null);
  const providerLinksQueries = useQueries({
    queries: configuredRows.map((row) => ({
      enabled: canManage && !providersQuery.isPending && row.config !== null,
      queryKey: organizationIdentityLinkProviderLinksQueryKey({
        activeOrganizationId,
        organizationProviderConfigId: row.config?.organizationProviderConfigId ?? row.rowKey,
      }),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        listOrganizationIdentityLinkProviderLinks({
          organizationProviderConfigId: row.config?.organizationProviderConfigId ?? row.rowKey,
          signal,
        }),
    })),
  });
  const providerLinksByConfigId = new Map<
    string,
    {
      data: readonly OrganizationIdentityLinkProviderLink[] | undefined;
      isPending: boolean;
      isError: boolean;
      error: unknown;
    }
  >(
    configuredRows.map((row, index) => [
      row.config?.organizationProviderConfigId ?? row.rowKey,
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
    if (createdConnectionId === null || providersQuery.data === undefined) {
      return;
    }

    const selection = resolveReturnedIdentityLinkConnectionSelection({
      connectionId: createdConnectionId,
      providers: providersQuery.data,
    });

    if (selection !== null) {
      setSelectedConnectionIdByRowKey((current) => ({
        ...current,
        [buildDraftRowKey(selection.providerFamily)]: selection.integrationConnectionId,
      }));
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
        onEnabledChange={async ({ rowKey, enabled }) => {
          const row = findProviderConfigRowOrThrow({
            rowKey,
            rows: providerConfigRows,
          });
          const status = enabled ? "active" : "disabled";
          const organizationProviderConfigId =
            row.config?.organizationProviderConfigId ??
            (await createConfigForDraftRow({
              row,
              createConfigMutation,
              selectedConnectionIdByRowKey,
            }));

          await statusMutation.mutateAsync({
            rowKey,
            organizationProviderConfigId,
            status,
          });
        }}
        onProviderConnectionChange={async ({ rowKey, integrationConnectionId }) => {
          const row = findProviderConfigRowOrThrow({
            rowKey,
            rows: providerConfigRows,
          });
          const previousDisplayedConnectionId = resolveRowDisplayedConnectionId({
            row,
            selectedConnectionIdByRowKey,
          });

          setSelectedConnectionIdByRowKey((current) => ({
            ...current,
            [rowKey]: integrationConnectionId,
          }));

          try {
            if (row.config === null) {
              await createConfigMutation.mutateAsync({
                rowKey,
                providerFamily: row.provider.providerFamily,
                integrationConnectionId,
              });
              setSelectedConnectionIdByRowKey((current) =>
                restoreSelectedConnectionDraft({
                  current,
                  rowKey,
                  selectedConnectionId: null,
                }),
              );
              return;
            }

            await updateConfigMutation.mutateAsync({
              rowKey,
              organizationProviderConfigId: row.config.organizationProviderConfigId,
              integrationConnectionId,
            });
          } catch (error) {
            setSelectedConnectionIdByRowKey((current) =>
              restoreSelectedConnectionDraft({
                current,
                rowKey,
                selectedConnectionId: previousDisplayedConnectionId,
              }),
            );

            throw error;
          }
        }}
        providers={providerConfigRows.map((row) =>
          buildProviderRow({
            configuringRowKey,
            statusUpdatingRowKey,
            row,
            providerLinksQuery:
              row.config === null
                ? null
                : (providerLinksByConfigId.get(row.config.organizationProviderConfigId) ?? null),
            selectedConnectionIdByRowKey,
          }),
        )}
      />
    </PageFrame>
  );
}

function buildProviderConfigRows(
  providers: readonly OrganizationIdentityLinkProvider[],
): ProviderConfigRow[] {
  return providers.flatMap((provider) => [
    ...provider.configs.map((config) => ({
      rowKey: config.organizationProviderConfigId,
      provider,
      config,
    })),
    {
      rowKey: buildDraftRowKey(provider.providerFamily),
      provider,
      config: null,
    },
  ]);
}

function buildDraftRowKey(providerFamily: string): string {
  return `${DraftConfigIdPrefix}${providerFamily}`;
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
  configuringRowKey: string | null;
  statusUpdatingRowKey: string | null;
  row: ProviderConfigRow;
  providerLinksQuery: {
    data: readonly OrganizationIdentityLinkProviderLink[] | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  } | null;
  selectedConnectionIdByRowKey: Readonly<Record<string, string | undefined>>;
}): OrganizationIdentityLinkingProviderRow {
  const eligibleConnections = listEligibleIdentityLinkConnections({
    provider: input.row.provider,
  });
  const selectedConnectionId = resolveRowDisplayedConnectionId({
    row: input.row,
    selectedConnectionIdByRowKey: input.selectedConnectionIdByRowKey,
  });

  return {
    rowKey: input.row.rowKey,
    providerFamily: input.row.provider.providerFamily,
    organizationProviderConfigId: input.row.config?.organizationProviderConfigId ?? null,
    displayName: input.row.provider.displayName,
    logoKey: input.row.provider.logoKey,
    connectionOptions: eligibleConnections.map((connection) => ({
      id: connection.id,
      label: formatIdentityLinkEligibleConnectionLabel(connection),
    })),
    selectedConnectionId,
    connectionPending: input.configuringRowKey === input.row.rowKey,
    enablePending: input.statusUpdatingRowKey === input.row.rowKey,
    enabled: input.row.config?.configurationStatus === "active",
    linkedUsersCount: input.providerLinksQuery?.data?.length ?? null,
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

function findProviderConfigRowOrThrow(input: {
  rowKey: string;
  rows: readonly ProviderConfigRow[];
}): ProviderConfigRow {
  const row = input.rows.find((candidate) => candidate.rowKey === input.rowKey) ?? null;
  if (row === null) {
    throw new Error(`Identity-linking provider row '${input.rowKey}' was not loaded.`);
  }

  return row;
}

async function createConfigForDraftRow(input: {
  row: ProviderConfigRow;
  createConfigMutation: {
    mutateAsync: (input: {
      rowKey: string;
      providerFamily: string;
      integrationConnectionId: string;
    }) => Promise<OrganizationIdentityLinkProviderConfig>;
  };
  selectedConnectionIdByRowKey: Readonly<Record<string, string | undefined>>;
}): Promise<string> {
  if (input.row.config !== null) {
    return input.row.config.organizationProviderConfigId;
  }

  const integrationConnectionId = resolveRowDisplayedConnectionId({
    row: input.row,
    selectedConnectionIdByRowKey: input.selectedConnectionIdByRowKey,
  });

  if (integrationConnectionId === null) {
    throw new Error(
      `Identity-linking provider '${input.row.provider.providerFamily}' cannot be enabled without a selected connection.`,
    );
  }

  const config = await input.createConfigMutation.mutateAsync({
    rowKey: input.row.rowKey,
    providerFamily: input.row.provider.providerFamily,
    integrationConnectionId,
  });

  return config.organizationProviderConfigId;
}

function resolveRowDisplayedConnectionId(input: {
  row: ProviderConfigRow;
  selectedConnectionIdByRowKey: Readonly<Record<string, string | undefined>>;
}): string | null {
  const eligibleConnections = listEligibleIdentityLinkConnections({
    provider: input.row.provider,
  });

  return resolveSelectedConnectionId({
    draftSelectedConnectionId: input.selectedConnectionIdByRowKey[input.row.rowKey],
    eligibleConnections,
    selectedConnectionId: input.row.config?.selectedConnection.id ?? null,
  });
}

function restoreSelectedConnectionDraft(input: {
  current: Readonly<Record<string, string | undefined>>;
  rowKey: string;
  selectedConnectionId: string | null;
}): Readonly<Record<string, string | undefined>> {
  if (input.selectedConnectionId === null) {
    const next = { ...input.current };
    delete next[input.rowKey];
    return next;
  }

  return {
    ...input.current,
    [input.rowKey]: input.selectedConnectionId,
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
