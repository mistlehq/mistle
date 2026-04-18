import {
  type ControlPlaneDatabase,
  OrganizationIdentityLinkProviderConfigStatus,
  type IntegrationConnection,
  integrationConnectionCredentials,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { inArray } from "drizzle-orm";

import { buildIntegrationConnectionResponse } from "../../integration-connections/services/build-integration-connection-response.js";
import {
  resolveIdentityLinkingDefinitionOrThrow,
  supportsIdentityLinkingConnection,
} from "./identity-linking-definition.js";
import { listIdentityLinkProviderMetadata } from "./provider-metadata.js";

export const IdentityLinkProviderConfigurationStatus = {
  UNCONFIGURED: "unconfigured",
  ACTIVE: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
  DISABLED: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
} as const;

export type IdentityLinkProviderConfigurationStatus =
  (typeof IdentityLinkProviderConfigurationStatus)[keyof typeof IdentityLinkProviderConfigurationStatus];

export type IdentityLinkProviderConnectionSummary = {
  id: string;
  targetKey: string;
  displayName: string;
  status: IntegrationConnection["status"];
  connectionMethodId?: string;
  connectionMethodLabel?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationIdentityLinkProvider = {
  providerFamily: string;
  displayName: string;
  logoKey: string;
  eligibleTargetKeys: string[];
  eligibleConnectionMethodIds: string[];
  eligibleConnections: IdentityLinkProviderConnectionSummary[];
  configurationStatus: IdentityLinkProviderConfigurationStatus;
  selectedConnection: IdentityLinkProviderConnectionSummary | null;
  configuredAt: string | null;
  updatedAt: string | null;
};

export async function listOrganizationIdentityLinkProviders(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
  },
): Promise<OrganizationIdentityLinkProvider[]> {
  const [providers, configs] = await Promise.all([
    listIdentityLinkProviderMetadata(ctx),
    ctx.db.query.organizationIdentityLinkProviderConfigs.findMany({
      columns: {
        providerFamily: true,
        status: true,
        integrationConnectionId: true,
        createdAt: true,
        updatedAt: true,
      },
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    }),
  ]);

  const eligibleTargetKeys = [
    ...new Set(providers.flatMap((provider) => provider.eligibleTargetKeys)),
  ];
  const connectionIds = configs.map((config) => config.integrationConnectionId);
  const connections =
    connectionIds.length === 0 && eligibleTargetKeys.length === 0
      ? []
      : await ctx.db.query.integrationConnections.findMany({
          columns: {
            id: true,
            targetKey: true,
            displayName: true,
            status: true,
            externalSubjectId: true,
            config: true,
            targetSnapshotConfig: true,
            createdAt: true,
            updatedAt: true,
          },
          where: (table, { and, eq, inArray, or }) => {
            const organizationScope = eq(table.organizationId, input.organizationId);
            const configuredConnectionScope =
              connectionIds.length === 0 ? undefined : inArray(table.id, connectionIds);
            const providerTargetScope =
              eligibleTargetKeys.length === 0
                ? undefined
                : inArray(table.targetKey, eligibleTargetKeys);

            if (configuredConnectionScope !== undefined && providerTargetScope !== undefined) {
              return and(organizationScope, or(configuredConnectionScope, providerTargetScope));
            }

            if (configuredConnectionScope !== undefined) {
              return and(organizationScope, configuredConnectionScope);
            }

            if (providerTargetScope !== undefined) {
              return and(organizationScope, providerTargetScope);
            }

            return organizationScope;
          },
        });

  const connectionTargetKeys = [...new Set(connections.map((connection) => connection.targetKey))];
  const connectionTargets =
    connectionTargetKeys.length === 0
      ? []
      : await ctx.db.query.integrationTargets.findMany({
          columns: {
            targetKey: true,
            familyId: true,
            variantId: true,
          },
          where: (table, { inArray }) => inArray(table.targetKey, connectionTargetKeys),
        });

  const configsByProviderFamily = new Map(configs.map((config) => [config.providerFamily, config]));
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const targetsByKey = new Map(connectionTargets.map((target) => [target.targetKey, target]));
  const connectionCredentialLinks =
    connections.length === 0
      ? []
      : await ctx.db
          .select({
            connectionId: integrationConnectionCredentials.connectionId,
            slotKey: integrationConnectionCredentials.slotKey,
          })
          .from(integrationConnectionCredentials)
          .where(
            inArray(
              integrationConnectionCredentials.connectionId,
              connections.map((connection) => connection.id),
            ),
          );
  const connectionCredentialSlotKeysByConnectionId = new Map<string, Set<string>>();
  for (const credentialLink of connectionCredentialLinks) {
    const slotKeys =
      connectionCredentialSlotKeysByConnectionId.get(credentialLink.connectionId) ??
      new Set<string>();
    slotKeys.add(credentialLink.slotKey);
    connectionCredentialSlotKeysByConnectionId.set(credentialLink.connectionId, slotKeys);
  }

  return Promise.all(
    providers.map(async (provider) => {
      const config = configsByProviderFamily.get(provider.providerFamily);
      const eligibleConnections: IdentityLinkProviderConnectionSummary[] = [];
      for (const connection of connections) {
        if (connection.status !== "active") {
          continue;
        }

        if (!provider.eligibleTargetKeys.includes(connection.targetKey)) {
          continue;
        }

        const rawConnectionMethodId = connection.config?.["connection_method"];
        if (typeof rawConnectionMethodId !== "string" || rawConnectionMethodId.length === 0) {
          continue;
        }

        if (!provider.eligibleConnectionMethodIds.includes(rawConnectionMethodId)) {
          continue;
        }

        const target = targetsByKey.get(connection.targetKey);
        if (target === undefined) {
          throw new Error(
            `Identity-link eligible connection '${connection.id}' references unknown target '${connection.targetKey}'.`,
          );
        }

        const definition = resolveIdentityLinkingDefinitionOrThrow({
          integrationRegistry: ctx.integrationRegistry,
          target,
        });

        let supportsConnection: boolean;
        try {
          supportsConnection = await supportsIdentityLinkingConnection({
            definition,
            connection,
            availableConnectionSecretSlotKeys:
              connectionCredentialSlotKeysByConnectionId.get(connection.id) ?? new Set<string>(),
          });
        } catch {
          continue;
        }

        if (!supportsConnection) {
          continue;
        }

        const connectionSummary = buildIntegrationConnectionResponse({
          connection,
          connectionMethods: definition.connectionMethods.map((method) => ({
            id: method.id,
            label: method.label,
          })),
        });

        eligibleConnections.push({
          id: connectionSummary.id,
          targetKey: connectionSummary.targetKey,
          displayName: connectionSummary.displayName,
          status: connectionSummary.status,
          ...(connectionSummary.connectionMethodId === undefined
            ? {}
            : { connectionMethodId: connectionSummary.connectionMethodId }),
          ...(connectionSummary.connectionMethodLabel === undefined
            ? {}
            : { connectionMethodLabel: connectionSummary.connectionMethodLabel }),
          createdAt: connectionSummary.createdAt,
          updatedAt: connectionSummary.updatedAt,
        });
      }
      eligibleConnections.sort((left, right) => {
        const displayNameOrder = left.displayName.localeCompare(right.displayName);
        if (displayNameOrder !== 0) {
          return displayNameOrder;
        }

        return left.id.localeCompare(right.id);
      });

      if (config === undefined) {
        return {
          providerFamily: provider.providerFamily,
          displayName: provider.displayName,
          logoKey: provider.logoKey,
          eligibleTargetKeys: provider.eligibleTargetKeys,
          eligibleConnectionMethodIds: provider.eligibleConnectionMethodIds,
          eligibleConnections,
          configurationStatus: IdentityLinkProviderConfigurationStatus.UNCONFIGURED,
          selectedConnection: null,
          configuredAt: null,
          updatedAt: null,
        };
      }

      const connection = connectionsById.get(config.integrationConnectionId);
      if (connection === undefined) {
        throw new Error(
          `Identity link provider config for '${provider.providerFamily}' references unknown connection '${config.integrationConnectionId}'.`,
        );
      }

      const target = targetsByKey.get(connection.targetKey);
      if (target === undefined) {
        throw new Error(
          `Identity link provider config for '${provider.providerFamily}' references unknown target '${connection.targetKey}'.`,
        );
      }

      const definition = ctx.integrationRegistry.getDefinition({
        familyId: target.familyId,
        variantId: target.variantId,
      });
      if (definition === undefined) {
        throw new Error(
          `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
        );
      }

      const connectionSummary = buildIntegrationConnectionResponse({
        connection,
        connectionMethods: definition.connectionMethods.map((method) => ({
          id: method.id,
          label: method.label,
        })),
      });

      return {
        providerFamily: provider.providerFamily,
        displayName: provider.displayName,
        logoKey: provider.logoKey,
        eligibleTargetKeys: provider.eligibleTargetKeys,
        eligibleConnectionMethodIds: provider.eligibleConnectionMethodIds,
        eligibleConnections,
        configurationStatus: config.status,
        selectedConnection: {
          id: connectionSummary.id,
          targetKey: connectionSummary.targetKey,
          displayName: connectionSummary.displayName,
          status: connectionSummary.status,
          ...(connectionSummary.connectionMethodId === undefined
            ? {}
            : { connectionMethodId: connectionSummary.connectionMethodId }),
          ...(connectionSummary.connectionMethodLabel === undefined
            ? {}
            : { connectionMethodLabel: connectionSummary.connectionMethodLabel }),
          createdAt: connectionSummary.createdAt,
          updatedAt: connectionSummary.updatedAt,
        },
        configuredAt: config.createdAt,
        updatedAt: config.updatedAt,
      };
    }),
  );
}
