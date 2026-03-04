import {
  IntegrationConnectionStatuses,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
} from "@mistle/db/control-plane";
import {
  IntegrationWebhookError,
  WebhookErrorCodes,
  normalizeWebhookHeaders,
  verifyAndParseWebhookOrThrow,
} from "@mistle/integrations-core";
import type { IntegrationConnection } from "@mistle/integrations-core";

import {
  decryptIntegrationConnectionSecrets,
  resolveMasterEncryptionKeyMaterial,
  type IntegrationConnectionSecrets,
} from "../../integration-credentials/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../integration-targets/services/resolve-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationWebhooksBadRequestCodes,
  IntegrationWebhooksBadRequestError,
  IntegrationWebhooksNotFoundCodes,
  IntegrationWebhooksNotFoundError,
} from "./errors.js";

export type ReceiveIntegrationWebhookInput = {
  targetKey: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: Uint8Array;
};

export type ReceivedIntegrationWebhook = {
  duplicate: boolean;
  webhookEventId?: string;
};

type ActiveWebhookConnection = {
  id: string;
  organizationId: string;
  status: IntegrationConnection["status"];
  externalSubjectId: string | null;
  config: Record<string, unknown> | null;
  secrets: {
    ciphertext: string;
    nonce: string;
    masterKeyVersion: number;
  } | null;
};

function toWebhookConnectionOrThrow(input: {
  targetKey: string;
  connection: ActiveWebhookConnection;
}): IntegrationConnection {
  if (input.connection.config === null) {
    throw new Error(
      `Integration connection '${input.connection.id}' for target '${input.targetKey}' is missing config.`,
    );
  }

  return {
    id: input.connection.id,
    status: input.connection.status,
    config: input.connection.config,
    ...(input.connection.externalSubjectId === null
      ? {}
      : { externalSubjectId: input.connection.externalSubjectId }),
  };
}

async function resolveConnectionSecretsOrThrow(input: {
  connectionId: string;
  connectionsById: ReadonlyMap<string, ActiveWebhookConnection>;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<IntegrationConnectionSecrets> {
  const connection = input.connectionsById.get(input.connectionId);

  if (connection === undefined) {
    throw new IntegrationWebhooksBadRequestError(
      IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST,
      `Webhook connection '${input.connectionId}' is not an active connection for this target.`,
    );
  }

  if (connection.secrets === null) {
    return {};
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: connection.secrets.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });

  return {
    ...decryptIntegrationConnectionSecrets({
      nonce: connection.secrets.nonce,
      ciphertext: connection.secrets.ciphertext,
      masterEncryptionKeyMaterial,
    }),
  };
}

export async function receiveIntegrationWebhook(
  db: AppContext["var"]["db"],
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: ReceiveIntegrationWebhookInput,
): Promise<ReceivedIntegrationWebhook> {
  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new IntegrationWebhooksNotFoundError(
      IntegrationWebhooksNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  const parsedTargetConfig = definition.targetConfigSchema.parse(target.config);
  const resolvedTargetSecrets = resolveIntegrationTargetSecrets({
    integrationsConfig,
    target,
  });
  const parsedTargetSecrets = definition.targetSecretSchema.parse(resolvedTargetSecrets);
  const activeConnections = await db.query.integrationConnections.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.targetKey, input.targetKey),
        eq(table.status, IntegrationConnectionStatuses.ACTIVE),
      ),
    columns: {
      id: true,
      organizationId: true,
      status: true,
      externalSubjectId: true,
      config: true,
      secrets: true,
    },
  });
  const activeConnectionsById: ReadonlyMap<string, ActiveWebhookConnection> = new Map(
    activeConnections.map((connection) => [connection.id, connection]),
  );
  const webhookConnections: ReadonlyArray<IntegrationConnection> = activeConnections.map(
    (connection) =>
      toWebhookConnectionOrThrow({
        targetKey: input.targetKey,
        connection,
      }),
  );

  let webhookEvent: Awaited<ReturnType<typeof verifyAndParseWebhookOrThrow>> | undefined;

  try {
    webhookEvent = await verifyAndParseWebhookOrThrow({
      definition,
      targetKey: input.targetKey,
      target: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
      connections: webhookConnections,
      resolveConnectionSecrets: ({ connectionId }) =>
        resolveConnectionSecretsOrThrow({
          connectionId,
          connectionsById: activeConnectionsById,
          integrationsConfig,
        }),
      headers: normalizeWebhookHeaders(input.headers),
      rawBody: input.rawBody,
    });
  } catch (error) {
    if (error instanceof IntegrationWebhookError) {
      if (error.code === WebhookErrorCodes.WEBHOOK_CONNECTION_NOT_FOUND) {
        throw new IntegrationWebhooksNotFoundError(
          IntegrationWebhooksNotFoundCodes.CONNECTION_NOT_FOUND,
          error.message,
        );
      }

      throw new IntegrationWebhooksBadRequestError(
        IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST,
        error.message,
      );
    }

    throw error;
  }

  if (webhookEvent === undefined) {
    throw new Error("Expected webhook event to be parsed.");
  }
  const resolvedConnection = activeConnectionsById.get(webhookEvent.connectionId);
  if (resolvedConnection === undefined) {
    throw new Error(
      `Expected resolved webhook connection '${webhookEvent.connectionId}' to exist in active connection candidates.`,
    );
  }

  const insertedRows = await db
    .insert(integrationWebhookEvents)
    .values({
      organizationId: resolvedConnection.organizationId,
      integrationConnectionId: resolvedConnection.id,
      targetKey: input.targetKey,
      externalEventId: webhookEvent.event.externalEventId,
      externalDeliveryId: webhookEvent.event.externalDeliveryId,
      eventType: webhookEvent.event.eventType,
      providerEventType: webhookEvent.event.providerEventType,
      payload: webhookEvent.event.payload,
      status: IntegrationWebhookEventStatuses.RECEIVED,
    })
    .onConflictDoNothing({
      target: [integrationWebhookEvents.targetKey, integrationWebhookEvents.externalEventId],
    })
    .returning({
      id: integrationWebhookEvents.id,
    });

  return {
    duplicate: insertedRows.length === 0,
    ...(insertedRows[0] === undefined ? {} : { webhookEventId: insertedRows[0].id }),
  };
}
