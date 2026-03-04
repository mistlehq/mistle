import {
  IntegrationConnectionStatuses,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
} from "@mistle/db/control-plane";
import {
  IntegrationWebhookError,
  normalizeWebhookHeaders,
  verifyAndParseWebhookOrThrow,
} from "@mistle/integrations-core";

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

type ResolvedConnectionSecrets = {
  connection: {
    id: string;
    organizationId: string;
  };
  secrets: IntegrationConnectionSecrets;
};

async function resolveConnectionSecretsOrThrow(input: {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  targetKey: string;
  externalSubjectId: string | undefined;
}): Promise<ResolvedConnectionSecrets> {
  if (input.externalSubjectId === undefined || input.externalSubjectId.length === 0) {
    throw new IntegrationWebhooksBadRequestError(
      IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST,
      "Webhook connection reference is missing externalSubjectId.",
    );
  }
  const externalSubjectId = input.externalSubjectId;

  const connection = await input.db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.targetKey, input.targetKey),
        eq(table.status, IntegrationConnectionStatuses.ACTIVE),
        eq(table.externalSubjectId, externalSubjectId),
      ),
  });

  if (connection === undefined) {
    throw new IntegrationWebhooksNotFoundError(
      IntegrationWebhooksNotFoundCodes.CONNECTION_NOT_FOUND,
      [
        `Integration connection was not found for target '${input.targetKey}'`,
        `with externalSubjectId '${input.externalSubjectId}'.`,
      ].join(" "),
    );
  }

  if (connection.secrets === null) {
    return {
      connection: {
        id: connection.id,
        organizationId: connection.organizationId,
      },
      secrets: {},
    };
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: connection.secrets.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });

  return {
    connection: {
      id: connection.id,
      organizationId: connection.organizationId,
    },
    secrets: decryptIntegrationConnectionSecrets({
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

  let webhookEvent: Awaited<ReturnType<typeof verifyAndParseWebhookOrThrow>> | undefined;
  let resolvedConnection:
    | {
        id: string;
        organizationId: string;
      }
    | undefined;

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
      resolveConnectionSecrets: async ({ connectionRef }) => {
        const resolvedConnectionSecrets = await resolveConnectionSecretsOrThrow({
          db,
          integrationsConfig,
          targetKey: connectionRef.targetKey,
          externalSubjectId: connectionRef.externalSubjectId,
        });

        resolvedConnection = resolvedConnectionSecrets.connection;
        return resolvedConnectionSecrets.secrets;
      },
      headers: normalizeWebhookHeaders(input.headers),
      rawBody: input.rawBody,
    });
  } catch (error) {
    if (error instanceof IntegrationWebhookError) {
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
  if (resolvedConnection === undefined) {
    throw new Error("Expected webhook connection to be resolved.");
  }

  const insertedRows = await db
    .insert(integrationWebhookEvents)
    .values({
      organizationId: resolvedConnection.organizationId,
      integrationConnectionId: resolvedConnection.id,
      targetKey: input.targetKey,
      externalEventId: webhookEvent.externalEventId,
      externalDeliveryId: webhookEvent.externalDeliveryId,
      eventType: webhookEvent.eventType,
      providerEventType: webhookEvent.providerEventType,
      payload: webhookEvent.payload,
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
