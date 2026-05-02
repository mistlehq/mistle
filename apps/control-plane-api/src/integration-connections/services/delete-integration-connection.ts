import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";
import { and, eq, inArray, sql } from "drizzle-orm";

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

  const [automationUsage] = await input.db
    .select({
      automationCount: sql<number>`count(*)::int`,
    })
    .from(tables.webhookAutomations)
    .innerJoin(
      tables.integrationWebhookSources,
      eq(tables.integrationWebhookSources.id, tables.webhookAutomations.integrationWebhookSourceId),
    )
    .where(eq(tables.integrationWebhookSources.integrationConnectionId, lockedConnection.id));

  if ((automationUsage?.automationCount ?? 0) > 0) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_HAS_AUTOMATIONS,
      "This integration connection cannot be deleted while it is still used by one or more webhook automations.",
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

export async function deleteIntegrationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: AppContext["var"]["integrationRegistry"];
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: DeleteIntegrationConnectionInput,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
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
              from "control_plane"."integration_connection_credentials" as linked_credentials
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
  });
}
