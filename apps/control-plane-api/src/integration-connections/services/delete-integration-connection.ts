import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationCredentials,
  integrationWebhookSources,
  sandboxProfileVersionIntegrationBindings,
  type ControlPlaneDatabase,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
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

async function assertConnectionDeletionGuardsOrThrow(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
}): Promise<void> {
  const [lockedConnection] = await input.db
    .select({
      id: integrationConnections.id,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, input.organizationId),
        eq(integrationConnections.id, input.connectionId),
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

  const [bindingUsage] = await input.db
    .select({
      bindingCount: sql<number>`count(*)::int`,
    })
    .from(sandboxProfileVersionIntegrationBindings)
    .where(eq(sandboxProfileVersionIntegrationBindings.connectionId, lockedConnection.id));

  if ((bindingUsage?.bindingCount ?? 0) > 0) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_HAS_BINDINGS,
      "This integration connection cannot be deleted while it is still used by one or more bindings.",
    );
  }

  const [automationUsage] = await input.db
    .select({
      automationCount: sql<number>`count(*)::int`,
    })
    .from(webhookAutomations)
    .innerJoin(
      integrationWebhookSources,
      eq(integrationWebhookSources.id, webhookAutomations.integrationWebhookSourceId),
    )
    .where(eq(integrationWebhookSources.integrationConnectionId, lockedConnection.id));

  if ((automationUsage?.automationCount ?? 0) > 0) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_HAS_AUTOMATIONS,
      "This integration connection cannot be deleted while it is still used by one or more webhook automations.",
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
    await assertConnectionDeletionGuardsOrThrow({
      db: tx,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });
  });

  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const connectionOwnedWebhookSources = await ctx.db.query.integrationWebhookSources.findMany({
    where: (table, { eq: whereEq }) => whereEq(table.integrationConnectionId, connection.id),
  });

  if (connectionOwnedWebhookSources.length > 0) {
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
            db: ctx.db,
            integrationRegistry: ctx.integrationRegistry,
            connection,
            integrationsConfig: ctx.integrationsConfig,
          });

          for (const source of connectionOwnedWebhookSources) {
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

  await ctx.db.transaction(async (tx) => {
    await assertConnectionDeletionGuardsOrThrow({
      db: tx,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });

    const connectionOwnedWebhookSources = await tx.query.integrationWebhookSources.findMany({
      columns: {
        id: true,
        webhookSecretCredentialId: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.integrationConnectionId, input.connectionId),
    });

    if (connectionOwnedWebhookSources.length > 0) {
      await tx
        .delete(integrationWebhookSources)
        .where(eq(integrationWebhookSources.integrationConnectionId, input.connectionId));
    }

    const webhookSecretCredentialIds = connectionOwnedWebhookSources
      .map((source) => source.webhookSecretCredentialId)
      .filter((credentialId): credentialId is string => credentialId !== null);

    if (webhookSecretCredentialIds.length > 0) {
      await tx
        .delete(integrationCredentials)
        .where(
          and(
            eq(integrationCredentials.organizationId, input.organizationId),
            inArray(integrationCredentials.id, webhookSecretCredentialIds),
          ),
        );
    }

    const linkedCredentials = await tx
      .select({
        credentialId: integrationConnectionCredentials.credentialId,
      })
      .from(integrationConnectionCredentials)
      .where(eq(integrationConnectionCredentials.connectionId, input.connectionId));

    await tx
      .delete(integrationConnectionCredentials)
      .where(eq(integrationConnectionCredentials.connectionId, input.connectionId));

    const credentialIds = linkedCredentials.map((credential) => credential.credentialId);
    if (credentialIds.length > 0) {
      await tx.delete(integrationCredentials).where(
        and(
          eq(integrationCredentials.organizationId, input.organizationId),
          inArray(integrationCredentials.id, credentialIds),
          sql`not exists (
              select 1
              from "control_plane"."integration_connection_credentials" as linked_credentials
              where linked_credentials.credential_id = ${integrationCredentials.id}
            )`,
        ),
      );
    }

    await tx
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, input.organizationId),
          eq(integrationConnections.id, input.connectionId),
        ),
      );
  });
}
