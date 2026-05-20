import {
  type ControlPlaneDatabase,
  OrganizationIdentityLinkProviderConfigStatus,
  type IntegrationConnection,
  getControlPlaneDatabaseSchema,
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
  organizationProviderConfigId: string | null;
  integrationConnectionId: string | null;
  displayName: string;
  logoKey: string;
  eligibleTargetKeys: string[];
  eligibleConnectionMethodIds: string[];
  eligibleConnections: IdentityLinkProviderConnectionSummary[];
  configurationStatus: IdentityLinkProviderConfigurationStatus;
  selectedConnection: IdentityLinkProviderConnectionSummary | null;
  configuredAt: string | null;
  updatedAt: string | null;
  configs: OrganizationIdentityLinkProviderConfig[];
};

export type OrganizationIdentityLinkProviderConfig = {
  organizationProviderConfigId: string;
  integrationConnectionId: string;
  configurationStatus: Exclude<
    IdentityLinkProviderConfigurationStatus,
    typeof IdentityLinkProviderConfigurationStatus.UNCONFIGURED
  >;
  selectedConnection: IdentityLinkProviderConnectionSummary;
  configuredAt: string;
  updatedAt: string;
};

type IdentityLinkProviderConfigConnection = Pick<
  IntegrationConnection,
  | "id"
  | "targetKey"
  | "displayName"
  | "status"
  | "externalSubjectId"
  | "config"
  | "targetSnapshotConfig"
  | "createdAt"
  | "updatedAt"
>;

export async function listOrganizationIdentityLinkProviders(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
  },
): Promise<OrganizationIdentityLinkProvider[]> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const [providers, configs] = await Promise.all([
    listIdentityLinkProviderMetadata(ctx),
    ctx.db.query.organizationIdentityLinkProviderConfigs.findMany({
      columns: {
        id: true,
        providerFamily: true,
        status: true,
        integrationConnectionId: true,
        createdAt: true,
        updatedAt: true,
      },
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
      orderBy: (table, { asc }) => [asc(table.providerFamily), asc(table.createdAt), asc(table.id)],
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

  const configsByProviderFamily = new Map<string, typeof configs>();
  for (const config of configs) {
    const providerConfigs = configsByProviderFamily.get(config.providerFamily) ?? [];
    providerConfigs.push(config);
    configsByProviderFamily.set(config.providerFamily, providerConfigs);
  }
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const targetsByKey = new Map(connectionTargets.map((target) => [target.targetKey, target]));
  const connectionCredentialLinks =
    connections.length === 0
      ? []
      : await ctx.db
          .select({
            connectionId: tables.integrationConnectionCredentials.connectionId,
            slotKey: tables.integrationConnectionCredentials.slotKey,
          })
          .from(tables.integrationConnectionCredentials)
          .where(
            inArray(
              tables.integrationConnectionCredentials.connectionId,
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
      const providerConfigs = configsByProviderFamily.get(provider.providerFamily) ?? [];
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

      const builtConfigs = providerConfigs
        .map((config) =>
          buildOrganizationIdentityLinkProviderConfig({
            config,
            connectionsById,
            integrationRegistry: ctx.integrationRegistry,
            providerFamily: provider.providerFamily,
            targetsByKey,
          }),
        )
        .sort((left, right) => {
          const connectionOrder = left.selectedConnection.displayName.localeCompare(
            right.selectedConnection.displayName,
          );
          if (connectionOrder !== 0) {
            return connectionOrder;
          }

          return left.organizationProviderConfigId.localeCompare(
            right.organizationProviderConfigId,
          );
        });

      const config = providerConfigs[0];
      if (config === undefined) {
        return {
          providerFamily: provider.providerFamily,
          organizationProviderConfigId: null,
          integrationConnectionId: null,
          displayName: provider.displayName,
          logoKey: provider.logoKey,
          eligibleTargetKeys: provider.eligibleTargetKeys,
          eligibleConnectionMethodIds: provider.eligibleConnectionMethodIds,
          eligibleConnections,
          configurationStatus: IdentityLinkProviderConfigurationStatus.UNCONFIGURED,
          selectedConnection: null,
          configuredAt: null,
          updatedAt: null,
          configs: builtConfigs,
        };
      }

      const primaryConfig = builtConfigs.find(
        (entry) => entry.organizationProviderConfigId === config.id,
      );
      if (primaryConfig === undefined) {
        throw new Error(`Failed to build identity-link provider config '${config.id}'.`);
      }

      return {
        providerFamily: provider.providerFamily,
        organizationProviderConfigId: config.id,
        integrationConnectionId: config.integrationConnectionId,
        displayName: provider.displayName,
        logoKey: provider.logoKey,
        eligibleTargetKeys: provider.eligibleTargetKeys,
        eligibleConnectionMethodIds: provider.eligibleConnectionMethodIds,
        eligibleConnections,
        configurationStatus: config.status,
        selectedConnection: primaryConfig.selectedConnection,
        configuredAt: config.createdAt,
        updatedAt: config.updatedAt,
        configs: builtConfigs,
      };
    }),
  );
}

function buildOrganizationIdentityLinkProviderConfig(input: {
  config: {
    id: string;
    providerFamily: string;
    status:
      | typeof OrganizationIdentityLinkProviderConfigStatus.ACTIVE
      | typeof OrganizationIdentityLinkProviderConfigStatus.DISABLED;
    integrationConnectionId: string;
    createdAt: string;
    updatedAt: string;
  };
  connectionsById: Map<string, IdentityLinkProviderConfigConnection>;
  integrationRegistry: IntegrationRegistry;
  providerFamily: string;
  targetsByKey: Map<string, { familyId: string; variantId: string; targetKey: string }>;
}): OrganizationIdentityLinkProviderConfig {
  const connection = input.connectionsById.get(input.config.integrationConnectionId);
  if (connection === undefined) {
    throw new Error(
      `Identity link provider config for '${input.providerFamily}' references unknown connection '${input.config.integrationConnectionId}'.`,
    );
  }

  const target = input.targetsByKey.get(connection.targetKey);
  if (target === undefined) {
    throw new Error(
      `Identity link provider config for '${input.providerFamily}' references unknown target '${connection.targetKey}'.`,
    );
  }

  const definition = input.integrationRegistry.getDefinition({
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
    organizationProviderConfigId: input.config.id,
    integrationConnectionId: input.config.integrationConnectionId,
    configurationStatus: input.config.status,
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
    configuredAt: input.config.createdAt,
    updatedAt: input.config.updatedAt,
  };
}
