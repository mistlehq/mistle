import { toast } from "@mistle/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { data, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  canManageOrganizationIdentityLinking,
  formatIdentityLinkProviderMemberStatus,
  type IdentityLinkEligibleConnection,
  listEligibleIdentityLinkConnections,
} from "../settings/identity-linking/organization-identity-linking-model.js";
import {
  createOrganizationIdentityLinkProviderConfig,
  getOrganizationIdentityLinkGitCommitSigningImpact,
  listOrganizationIdentityLinkProviderLinks,
  listOrganizationIdentityLinkProviders,
  organizationIdentityLinkGitCommitSigningImpactQueryKey,
  organizationIdentityLinkProviderLinksQueryKey,
  organizationIdentityLinkProvidersQueryKey,
  type OrganizationIdentityLinkProviderConfig,
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

type IdentityLinkingConnectionRow = {
  rowKey: string;
  provider: OrganizationIdentityLinkProvider;
  connection: IdentityLinkEligibleConnection | null;
  config: OrganizationIdentityLinkProviderConfig | null;
  available: boolean;
};
type ConfiguredIdentityLinkingConnectionRow = IdentityLinkingConnectionRow & {
  config: OrganizationIdentityLinkProviderConfig;
};

type PendingGitCommitSigningImpactConfirmation = {
  rowKey: string;
  enabled: boolean;
  action: "enable" | "disable";
  connectionLabel: string;
  providerDisplayName: string;
  updatedProfileCount: number;
  invariantViolationCount: number;
};

export function OrganizationIdentityLinkingSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const activeOrganizationId = useRequiredOrganizationId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Identity Linking");
  const [configuringRowKey, setConfiguringRowKey] = useState<string | null>(null);
  const [statusUpdatingRowKey, setStatusUpdatingRowKey] = useState<string | null>(null);
  const [gitCommitSigningImpactConfirmation, setGitCommitSigningImpactConfirmation] =
    useState<PendingGitCommitSigningImpactConfirmation | null>(null);

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
      status: "active" | "disabled";
    }) =>
      createOrganizationIdentityLinkProviderConfig({
        providerFamily: input.providerFamily,
        integrationConnectionId: input.integrationConnectionId,
        status: input.status,
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
  const connectionRows = useMemo(() => buildIdentityLinkingConnectionRows(providers), [providers]);
  const configuredRows = connectionRows.filter(isConfiguredIdentityLinkingConnectionRow);
  const providerLinksQueries = useQueries({
    queries: configuredRows.map((row) => ({
      enabled: canManage && !providersQuery.isPending,
      queryKey: organizationIdentityLinkProviderLinksQueryKey({
        activeOrganizationId,
        organizationProviderConfigId: row.config.organizationProviderConfigId,
      }),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        listOrganizationIdentityLinkProviderLinks({
          organizationProviderConfigId: row.config.organizationProviderConfigId,
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
      row.config.organizationProviderConfigId,
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

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("createdConnectionId");
    setSearchParams(nextSearchParams, { replace: true });
  }, [createdConnectionId, searchParams, setSearchParams]);

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

  const applyEnabledChange = async (input: { rowKey: string; enabled: boolean }) => {
    const row = findIdentityLinkingConnectionRowOrThrow({
      rowKey: input.rowKey,
      rows: connectionRows,
    });

    if (row.config === null && !input.enabled) {
      return;
    }

    const status = input.enabled ? "active" : "disabled";

    if (row.config === null) {
      const connection = row.connection;
      if (connection === null) {
        throw new Error(
          "Identity-linking providers without eligible connections cannot be enabled.",
        );
      }
      if (!row.available) {
        throw new Error("Unavailable identity-linking connections cannot be enabled.");
      }

      await createConfigMutation.mutateAsync({
        rowKey: row.rowKey,
        providerFamily: row.provider.providerFamily,
        integrationConnectionId: connection.id,
        status,
      });
      return;
    }

    await statusMutation.mutateAsync({
      rowKey: input.rowKey,
      organizationProviderConfigId: row.config.organizationProviderConfigId,
      status,
    });
  };

  return (
    <PageFrame description={description} width="normal" title={title}>
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={
          gitCommitSigningImpactConfirmation === null
            ? null
            : {
                action: gitCommitSigningImpactConfirmation.action,
                connectionLabel: gitCommitSigningImpactConfirmation.connectionLabel,
                providerDisplayName: gitCommitSigningImpactConfirmation.providerDisplayName,
                updatedProfileCount: gitCommitSigningImpactConfirmation.updatedProfileCount,
                invariantViolationCount: gitCommitSigningImpactConfirmation.invariantViolationCount,
                pending:
                  configuringRowKey === gitCommitSigningImpactConfirmation.rowKey ||
                  statusUpdatingRowKey === gitCommitSigningImpactConfirmation.rowKey,
              }
        }
        loadErrorMessage={resolveLoadErrorMessage({
          canManage,
          providersError: providersQuery.isError ? providersQuery.error : null,
        })}
        onCancelGitCommitSigningImpactConfirmation={() => {
          setGitCommitSigningImpactConfirmation(null);
        }}
        onEnabledChange={async ({ rowKey, enabled }) => {
          const row = findIdentityLinkingConnectionRowOrThrow({
            rowKey,
            rows: connectionRows,
          });

          if (row.config === null && !enabled) {
            return;
          }

          let impactConfirmation: Omit<
            PendingGitCommitSigningImpactConfirmation,
            "rowKey" | "enabled"
          > | null;

          try {
            impactConfirmation = await loadGitCommitSigningImpactConfirmation({
              activeOrganizationId,
              enabled,
              queryClient,
              row,
            });
          } catch (error) {
            toast.error(
              resolveApiErrorMessage({
                error,
                fallbackMessage: "Could not load commit-signing impact.",
              }),
            );
            return;
          }

          if (impactConfirmation !== null) {
            setGitCommitSigningImpactConfirmation({
              rowKey,
              enabled,
              ...impactConfirmation,
            });
            return;
          }

          await applyEnabledChange({ rowKey, enabled });
        }}
        onConfirmGitCommitSigningImpactConfirmation={async () => {
          const confirmation = gitCommitSigningImpactConfirmation;
          if (confirmation === null) {
            return;
          }

          try {
            await applyEnabledChange({
              rowKey: confirmation.rowKey,
              enabled: confirmation.enabled,
            });
            setGitCommitSigningImpactConfirmation(null);
          } catch {
            return;
          }
        }}
        providers={connectionRows.map((row) =>
          buildProviderRow({
            configuringRowKey,
            statusUpdatingRowKey,
            row,
            providerLinksQuery:
              row.config === null
                ? null
                : (providerLinksByConfigId.get(row.config.organizationProviderConfigId) ?? null),
          }),
        )}
      />
    </PageFrame>
  );
}

export function buildIdentityLinkingConnectionRows(
  providers: readonly OrganizationIdentityLinkProvider[],
): IdentityLinkingConnectionRow[] {
  return providers.flatMap((provider) => buildProviderConnectionRows(provider));
}

function buildProviderConnectionRows(
  provider: OrganizationIdentityLinkProvider,
): IdentityLinkingConnectionRow[] {
  const configByConnectionId = new Map<string, OrganizationIdentityLinkProviderConfig>();
  for (const config of provider.configs) {
    if (configByConnectionId.has(config.integrationConnectionId)) {
      throw new Error(
        `Identity-linking provider '${provider.providerFamily}' returned multiple configurations for connection '${config.integrationConnectionId}'.`,
      );
    }
    configByConnectionId.set(config.integrationConnectionId, config);
  }

  const eligibleConnections = listEligibleIdentityLinkConnections({ provider });
  const eligibleConnectionIds = new Set(eligibleConnections.map((connection) => connection.id));
  const eligibleRows = eligibleConnections.map((connection) => ({
    rowKey: buildConnectionRowKey({
      providerFamily: provider.providerFamily,
      integrationConnectionId: connection.id,
    }),
    provider,
    connection,
    config: configByConnectionId.get(connection.id) ?? null,
    available: true,
  }));
  const unavailableRows = provider.configs.flatMap((config) => {
    if (eligibleConnectionIds.has(config.integrationConnectionId)) {
      return [];
    }

    return [
      {
        rowKey: buildConnectionRowKey({
          providerFamily: provider.providerFamily,
          integrationConnectionId: config.integrationConnectionId,
        }),
        provider,
        connection: toIdentityLinkEligibleConnection(config.selectedConnection),
        config,
        available: false,
      },
    ];
  });

  const rows = [...eligibleRows, ...unavailableRows];
  if (rows.length > 0) {
    return rows;
  }

  return [
    {
      rowKey: buildProviderWithoutConnectionRowKey(provider.providerFamily),
      provider,
      connection: null,
      config: null,
      available: false,
    },
  ];
}

function buildConnectionRowKey(input: {
  providerFamily: string;
  integrationConnectionId: string;
}): string {
  return `${input.providerFamily}:${input.integrationConnectionId}`;
}

function buildProviderWithoutConnectionRowKey(providerFamily: string): string {
  return `${providerFamily}:no-eligible-connection`;
}

function isConfiguredIdentityLinkingConnectionRow(
  row: IdentityLinkingConnectionRow,
): row is ConfiguredIdentityLinkingConnectionRow {
  return row.config !== null;
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
  row: IdentityLinkingConnectionRow;
  providerLinksQuery: {
    data: readonly OrganizationIdentityLinkProviderLink[] | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  } | null;
}): OrganizationIdentityLinkingProviderRow {
  return {
    rowKey: input.row.rowKey,
    canOpenMemberLinkStatus: input.row.config !== null,
    displayName: input.row.provider.displayName,
    logoKey: input.row.provider.logoKey,
    connectionLabel:
      input.row.connection === null
        ? "No eligible active connections"
        : input.row.connection.displayName,
    enablePending:
      input.configuringRowKey === input.row.rowKey ||
      input.statusUpdatingRowKey === input.row.rowKey,
    enabled: input.row.config?.configurationStatus === "active",
    unavailableMessage: resolveUnavailableConnectionMessage(input.row),
    memberLinkStatusCounts:
      input.providerLinksQuery?.data === undefined
        ? null
        : {
            linked: input.providerLinksQuery.data.filter((link) => link.linked).length,
            total: input.providerLinksQuery.data.length,
          },
    memberLinksErrorMessage:
      input.providerLinksQuery !== null && input.providerLinksQuery.isError
        ? resolveApiErrorMessage({
            error: input.providerLinksQuery.error,
            fallbackMessage: "Could not load link status.",
          })
        : null,
    memberLinks:
      input.providerLinksQuery?.data?.map((link) => ({
        userId: link.userId,
        name: link.name,
        email: link.email,
        linked: link.linked,
        statusLabel: formatIdentityLinkProviderMemberStatus({
          linked: link.linked,
        }),
      })) ?? [],
  };
}

function resolveUnavailableConnectionMessage(row: IdentityLinkingConnectionRow): string | null {
  if (row.available) {
    return null;
  }

  if (row.connection === null) {
    return "Add an active connection before enabling identity linking.";
  }

  if (row.config?.configurationStatus === "active") {
    return "This connection is no longer active. Disable identity linking or reconnect it.";
  }

  return "This connection is no longer active. Reconnect it before enabling identity linking.";
}

async function loadGitCommitSigningImpactConfirmation(input: {
  activeOrganizationId: string;
  enabled: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  row: IdentityLinkingConnectionRow;
}): Promise<Omit<PendingGitCommitSigningImpactConfirmation, "rowKey" | "enabled"> | null> {
  if (input.row.provider.providerFamily !== "github") {
    return null;
  }

  if (input.row.connection === null) {
    return null;
  }

  const integrationConnectionId = input.row.connection.id;
  const action = input.enabled ? "enable" : "disable";
  const impact = await input.queryClient.fetchQuery({
    queryKey: organizationIdentityLinkGitCommitSigningImpactQueryKey({
      activeOrganizationId: input.activeOrganizationId,
      providerFamily: input.row.provider.providerFamily,
      integrationConnectionId,
      action,
    }),
    queryFn: async ({ signal }) =>
      getOrganizationIdentityLinkGitCommitSigningImpact({
        providerFamily: input.row.provider.providerFamily,
        integrationConnectionId,
        action,
        signal,
      }),
  });

  if (impact.updatedProfileCount === 0 && impact.invariantViolationCount === 0) {
    return null;
  }

  return {
    action,
    connectionLabel: input.row.connection.displayName,
    providerDisplayName: input.row.provider.displayName,
    updatedProfileCount: impact.updatedProfileCount,
    invariantViolationCount: impact.invariantViolationCount,
  };
}

function findIdentityLinkingConnectionRowOrThrow(input: {
  rowKey: string;
  rows: readonly IdentityLinkingConnectionRow[];
}): IdentityLinkingConnectionRow {
  const row = input.rows.find((candidate) => candidate.rowKey === input.rowKey) ?? null;
  if (row === null) {
    throw new Error(`Identity-linking connection row '${input.rowKey}' was not loaded.`);
  }

  return row;
}

function toIdentityLinkEligibleConnection(
  connection: OrganizationIdentityLinkProviderConfig["selectedConnection"],
): IdentityLinkEligibleConnection {
  return {
    id: connection.id,
    targetKey: connection.targetKey,
    displayName: connection.displayName,
    ...(connection.connectionMethodId === undefined
      ? {}
      : { connectionMethodId: connection.connectionMethodId }),
    ...(connection.connectionMethodLabel === undefined
      ? {}
      : { connectionMethodLabel: connection.connectionMethodLabel }),
  };
}
