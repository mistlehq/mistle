import {
  IntegrationCredentialSecretKinds,
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookSourceLifecycles,
  createOAuth2AuthorizationCodeCredentialSlotKeys,
} from "@mistle/integrations-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import { resolveConnectionSecretOrThrow } from "../../identity-linking/services/resolve-connection-secret.js";
import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import { logger } from "../../logger.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { listActiveSandboxProfileBindingCountsByConnectionId } from "./list-active-sandbox-profile-binding-counts-by-connection-id.js";
import {
  resolveConnectionConfigOrThrow,
  resolveConnectionSecretsOrThrow,
  resolveConnectionWithTargetOrThrow,
  resolveWebhookSourceCapabilityOrThrow,
} from "./webhook-sources.js";

export type DeleteIntegrationConnectionInput = {
  organizationId: string;
  connectionId: string;
};

type RevocationCredentialValues = {
  accessToken?: string;
  refreshToken?: string;
  clientSecret?: string;
};

type PendingConnectionAuthorizationRevocation = {
  connectionId: string;
  targetKey: string;
  revoke: () => Promise<void>;
};

async function lockAffectedSandboxProfilesForUpdate(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  await input.db
    .select({
      id: tables.sandboxProfiles.id,
    })
    .from(tables.sandboxProfiles)
    .where(
      and(
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
        inArray(
          tables.sandboxProfiles.id,
          input.db
            .select({
              sandboxProfileId: tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
            })
            .from(tables.sandboxProfileVersionIntegrationBindings)
            .where(
              eq(tables.sandboxProfileVersionIntegrationBindings.connectionId, input.connectionId),
            ),
        ),
      ),
    )
    .for("update");
}

async function assertConnectionDeletionGuardsOrThrow(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  const [lockedConnection] = await input.db
    .select({
      id: tables.integrationConnections.id,
    })
    .from(tables.integrationConnections)
    .where(
      and(
        eq(tables.integrationConnections.organizationId, input.organizationId),
        eq(tables.integrationConnections.id, input.connectionId),
      ),
    )
    .limit(1)
    .for("update");

  if (lockedConnection === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  await lockAffectedSandboxProfilesForUpdate({
    db: input.db,
    organizationId: input.organizationId,
    connectionId: lockedConnection.id,
  });

  const activeVersionBindingCountsByConnectionId =
    await listActiveSandboxProfileBindingCountsByConnectionId({
      db: input.db,
      connectionIds: [lockedConnection.id],
      organizationId: input.organizationId,
    });

  if ((activeVersionBindingCountsByConnectionId.get(lockedConnection.id) ?? 0) > 0) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_HAS_BINDINGS,
      "This integration connection cannot be deleted while it is still used by one or more active sandbox profile versions.",
    );
  }

  const [triggerUsage] = await input.db
    .select({
      triggerCount: sql<number>`count(*)::int`,
    })
    .from(tables.webhookTriggers)
    .innerJoin(
      tables.integrationWebhookSources,
      eq(tables.integrationWebhookSources.id, tables.webhookTriggers.integrationWebhookSourceId),
    )
    .where(eq(tables.integrationWebhookSources.integrationConnectionId, lockedConnection.id));

  if ((triggerUsage?.triggerCount ?? 0) > 0) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_HAS_TRIGGERS,
      "This integration connection cannot be deleted while it is still used by one or more webhook triggers.",
    );
  }

  const activeIdentityLinkProviderConfig =
    await input.db.query.organizationIdentityLinkProviderConfigs.findFirst({
      columns: {
        providerFamily: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.integrationConnectionId, lockedConnection.id),
          eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
        ),
    });

  if (activeIdentityLinkProviderConfig !== undefined) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_USED_BY_IDENTITY_LINKING,
      "This integration connection cannot be deleted while it is configured for Identity Linking.",
    );
  }
}

async function resolveOptionalConnectionSecret(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
  slotKey: string;
  secretKind: (typeof IntegrationCredentialSecretKinds)[keyof typeof IntegrationCredentialSecretKinds];
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
}): Promise<string | undefined> {
  const linkedCredential = await input.db.query.integrationConnectionCredentials.findFirst({
    columns: {
      credentialId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.connectionId, input.connectionId),
        whereEq(table.slotKey, input.slotKey),
      ),
  });

  if (linkedCredential === undefined) {
    return undefined;
  }

  return resolveConnectionSecretOrThrow(input);
}

async function resolveOAuth2AuthorizationCodeRevocationCredentials(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connection: Awaited<ReturnType<typeof resolveConnectionWithTargetOrThrow>>;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<RevocationCredentialValues> {
  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: input.connection.id,
    config: input.connection.config,
  });

  if (
    connectionConfig["connection_method"] !==
    IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE
  ) {
    return {};
  }

  const slotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
    familyId: input.connection.target.familyId,
    variantId: input.connection.target.variantId,
  });
  const [accessToken, refreshToken, clientSecret] = await Promise.all([
    resolveOptionalConnectionSecret({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.connection.id,
      slotKey: slotKeys.accessToken,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      integrationsConfig: input.integrationsConfig,
    }),
    resolveOptionalConnectionSecret({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.connection.id,
      slotKey: slotKeys.refreshToken,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      integrationsConfig: input.integrationsConfig,
    }),
    resolveOptionalConnectionSecret({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.connection.id,
      slotKey: slotKeys.clientSecret,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      integrationsConfig: input.integrationsConfig,
    }),
  ]);

  return {
    ...(accessToken === undefined ? {} : { accessToken }),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(clientSecret === undefined ? {} : { clientSecret }),
  };
}

async function prepareConnectionAuthorizationRevocation(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: AppContext["var"]["integrationRegistry"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connection: Awaited<ReturnType<typeof resolveConnectionWithTargetOrThrow>>;
}): Promise<PendingConnectionAuthorizationRevocation | undefined> {
  const definition = input.integrationRegistry.getDefinition({
    familyId: input.connection.target.familyId,
    variantId: input.connection.target.variantId,
  });
  const authorizationRevocation = definition?.authorizationRevocation;
  if (definition === undefined || authorizationRevocation === undefined) {
    return undefined;
  }

  try {
    const connectionConfig = resolveConnectionConfigOrThrow({
      connectionId: input.connection.id,
      config: input.connection.config,
    });
    const target = {
      familyId: input.connection.target.familyId,
      variantId: input.connection.target.variantId,
      enabled: input.connection.target.enabled,
      config: definition.targetConfigSchema.parse(input.connection.target.config),
      secrets: definition.targetSecretSchema.parse(
        resolveIntegrationTargetSecrets({
          integrationsConfig: input.integrationsConfig,
          target: input.connection.target,
        }),
      ),
    };
    const connection = {
      id: input.connection.id,
      status: input.connection.status,
      config: connectionConfig,
    };
    const credentials = await resolveOAuth2AuthorizationCodeRevocationCredentials({
      db: input.db,
      organizationId: input.organizationId,
      connection: input.connection,
      integrationsConfig: input.integrationsConfig,
    });

    return {
      connectionId: input.connection.id,
      targetKey: input.connection.targetKey,
      revoke: async () => {
        await authorizationRevocation.revokeConnectionAuthorization({
          organizationId: input.organizationId,
          targetKey: input.connection.targetKey,
          target,
          connection,
          credentials,
        });
      },
    };
  } catch (error) {
    logger.warn(
      {
        err: error,
        connectionId: input.connection.id,
        targetKey: input.connection.targetKey,
      },
      "Failed to prepare integration connection authorization revocation",
    );
    return undefined;
  }
}

async function revokeConnectionAuthorizationBestEffort(
  pendingRevocation: PendingConnectionAuthorizationRevocation | undefined,
): Promise<void> {
  if (pendingRevocation === undefined) {
    return;
  }

  try {
    await pendingRevocation.revoke();
  } catch (error) {
    logger.warn(
      {
        err: error,
        connectionId: pendingRevocation.connectionId,
        targetKey: pendingRevocation.targetKey,
      },
      "Failed to revoke integration connection authorization",
    );
  }
}

export async function deleteIntegrationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: AppContext["var"]["integrationRegistry"];
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: DeleteIntegrationConnectionInput,
): Promise<void> {
  const pendingRevocation = await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    await assertConnectionDeletionGuardsOrThrow({
      db: tx,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });

    const connection = await resolveConnectionWithTargetOrThrow({
      db: tx,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });
    const revocation = await prepareConnectionAuthorizationRevocation({
      db: tx,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
      organizationId: input.organizationId,
      connection,
    });
    const webhookSourcesForRegistrationCleanup = await tx.query.integrationWebhookSources.findMany({
      where: (table, { eq: whereEq }) => whereEq(table.integrationConnectionId, connection.id),
    });

    if (webhookSourcesForRegistrationCleanup.length > 0) {
      const definition = ctx.integrationRegistry.getDefinition({
        familyId: connection.target.familyId,
        variantId: connection.target.variantId,
      });

      if (definition?.webhookSource !== undefined) {
        const { webhookSourceCapability, parsedTargetConfig, parsedTargetSecrets } =
          resolveWebhookSourceCapabilityOrThrow({
            integrationRegistry: ctx.integrationRegistry,
            integrationsConfig: ctx.integrationsConfig,
            target: connection.target,
          });

        if (webhookSourceCapability.lifecycle === IntegrationWebhookSourceLifecycles.MANAGED) {
          const deleteRegistration =
            webhookSourceCapability.deleteRegistration?.bind(webhookSourceCapability);

          if (deleteRegistration !== undefined) {
            const connectionSecrets = await resolveConnectionSecretsOrThrow({
              db: tx,
              integrationRegistry: ctx.integrationRegistry,
              connection,
              integrationsConfig: ctx.integrationsConfig,
            });

            for (const source of webhookSourcesForRegistrationCleanup) {
              await deleteRegistration({
                organizationId: input.organizationId,
                targetKey: connection.targetKey,
                controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
                target: {
                  familyId: connection.target.familyId,
                  variantId: connection.target.variantId,
                  enabled: connection.target.enabled,
                  config: parsedTargetConfig,
                  secrets: parsedTargetSecrets,
                },
                connection: {
                  id: connection.id,
                  status: "active",
                  config: resolveConnectionConfigOrThrow({
                    connectionId: connection.id,
                    config: connection.config,
                  }),
                },
                connectionSecrets,
                source: {
                  id: source.id,
                  targetKey: source.targetKey,
                  organizationId: source.organizationId,
                  integrationConnectionId: source.integrationConnectionId,
                  ...(source.displayName === null ? {} : { displayName: source.displayName }),
                  endpointKey: source.endpointKey,
                  ...(source.remoteRegistrationId === null
                    ? {}
                    : { remoteRegistrationId: source.remoteRegistrationId }),
                  providerMetadata: source.providerMetadata,
                },
              });
            }
          }
        }
      }
    }

    await tx
      .delete(tables.sandboxProfileVersionIntegrationBindings)
      .where(eq(tables.sandboxProfileVersionIntegrationBindings.connectionId, input.connectionId));

    const connectionOwnedWebhookSources = await tx.query.integrationWebhookSources.findMany({
      columns: {
        id: true,
        webhookSecretCredentialId: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.integrationConnectionId, input.connectionId),
    });

    if (connectionOwnedWebhookSources.length > 0) {
      await tx
        .delete(tables.integrationWebhookSources)
        .where(eq(tables.integrationWebhookSources.integrationConnectionId, input.connectionId));
    }

    const webhookSecretCredentialIds = connectionOwnedWebhookSources
      .map((source) => source.webhookSecretCredentialId)
      .filter((credentialId): credentialId is string => credentialId !== null);

    if (webhookSecretCredentialIds.length > 0) {
      await tx
        .delete(tables.integrationCredentials)
        .where(
          and(
            eq(tables.integrationCredentials.organizationId, input.organizationId),
            inArray(tables.integrationCredentials.id, webhookSecretCredentialIds),
          ),
        );
    }

    const linkedCredentials = await tx
      .select({
        credentialId: tables.integrationConnectionCredentials.credentialId,
      })
      .from(tables.integrationConnectionCredentials)
      .where(eq(tables.integrationConnectionCredentials.connectionId, input.connectionId));

    await tx
      .delete(tables.integrationConnectionCredentials)
      .where(eq(tables.integrationConnectionCredentials.connectionId, input.connectionId));

    const credentialIds = linkedCredentials.map((credential) => credential.credentialId);
    if (credentialIds.length > 0) {
      await tx.delete(tables.integrationCredentials).where(
        and(
          eq(tables.integrationCredentials.organizationId, input.organizationId),
          inArray(tables.integrationCredentials.id, credentialIds),
          sql`not exists (
              select 1
              from ${tables.integrationConnectionCredentials} as linked_credentials
              where linked_credentials.credential_id = ${tables.integrationCredentials.id}
            )`,
        ),
      );
    }

    await tx
      .delete(tables.integrationConnections)
      .where(
        and(
          eq(tables.integrationConnections.organizationId, input.organizationId),
          eq(tables.integrationConnections.id, input.connectionId),
        ),
      );

    return revocation;
  });

  await revokeConnectionAuthorizationBestEffort(pendingRevocation);
}
