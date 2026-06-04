import {
  IntegrationConnectionStatuses,
  IntegrationWebhookEventStatuses,
  IntegrationWebhookSourceStatuses,
  type IntegrationWebhookSource,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationWebhookError,
  WebhookErrorCodes,
  createIntegrationWebhookRequestSnapshot,
  getWebhookHandlerOrThrow,
  normalizeWebhookHeaders,
  runIntegrationWebhookMiddleware,
  verifyAndResolveWebhookRequestOrThrow,
} from "@mistle/integrations-core";
import type {
  IntegrationConnection,
  IntegrationWebhookImmediateResponse,
  IntegrationWebhookMiddlewareBaseContext,
  IntegrationWebhookRequestResolution,
} from "@mistle/integrations-core";
import { and, eq, isNull } from "drizzle-orm";

import {
  resolveConnectionSecretsOrThrow,
  resolveConnectionWithTargetOrThrow,
} from "../../integration-connections/services/webhook-sources.js";
import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationWebhooksBadRequestCodes,
  IntegrationWebhooksNotFoundCodes,
} from "../constants.js";
import { logIntegrationWebhookEvent, withIntegrationWebhookSpan } from "../telemetry.js";
import { resolveWebhookActingUser } from "./resolve-webhook-acting-user.js";

export type ReceiveIntegrationWebhookInput = {
  targetKey: string;
  endpointKey: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: Uint8Array;
};

export type ReceivedIntegrationWebhook =
  | {
      kind: "accepted";
      duplicate: boolean;
      externalDeliveryId: string | null;
      integrationConnectionId: string;
      targetKey: string;
      webhookEventId?: string;
    }
  | {
      kind: "response";
      response: IntegrationWebhookImmediateResponse;
    };

type ActiveWebhookConnection = {
  id: string;
  organizationId: string;
  status: IntegrationConnection["status"];
  externalSubjectId: string | null;
  config: Record<string, unknown> | null;
};

type ResolvedWebhookSourceContext = {
  activeConnections: ReadonlyArray<ActiveWebhookConnection>;
  activeConnectionsById: ReadonlyMap<string, ActiveWebhookConnection>;
  webhookConnections: ReadonlyArray<IntegrationConnection>;
  webhookSource: IntegrationWebhookSource;
  webhookSourceSecrets: Record<string, string>;
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

function throwMappedWebhookError(error: IntegrationWebhookError): never {
  if (error.code === WebhookErrorCodes.WEBHOOK_CONNECTION_NOT_FOUND) {
    throw new NotFoundError(IntegrationWebhooksNotFoundCodes.CONNECTION_NOT_FOUND, error.message);
  }

  throw new BadRequestError(
    IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST,
    error.message,
  );
}

function assertConnectionCandidateExistsOrThrow(input: {
  connectionId: string;
  connectionsById: ReadonlyMap<string, ActiveWebhookConnection>;
}): void {
  const connection = input.connectionsById.get(input.connectionId);

  if (connection === undefined) {
    throw new BadRequestError(
      IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST,
      `Webhook connection '${input.connectionId}' is not an active connection for this target.`,
    );
  }
}

async function resolveWebhookSourceSecretOrThrow(input: {
  db: AppContext["var"]["db"];
  source: IntegrationWebhookSource;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<Record<string, string>> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  const webhookSecretCredentialId = input.source.webhookSecretCredentialId;
  if (webhookSecretCredentialId == null) {
    return {};
  }

  const organizationId = input.source.organizationId;
  if (organizationId == null) {
    throw new Error(
      `Webhook source '${input.source.id}' is missing organizationId for credential resolution.`,
    );
  }

  const [credential] = await input.db
    .select({
      credentialCiphertext: tables.integrationCredentials.ciphertext,
      credentialNonce: tables.integrationCredentials.nonce,
      organizationCredentialKeyCiphertext: tables.organizationCredentialKeys.ciphertext,
      organizationCredentialKeyMasterKeyVersion: tables.organizationCredentialKeys.masterKeyVersion,
    })
    .from(tables.integrationCredentials)
    .innerJoin(
      tables.organizationCredentialKeys,
      and(
        eq(
          tables.organizationCredentialKeys.organizationId,
          tables.integrationCredentials.organizationId,
        ),
        eq(
          tables.organizationCredentialKeys.version,
          tables.integrationCredentials.organizationCredentialKeyVersion,
        ),
      ),
    )
    .where(
      and(
        eq(tables.integrationCredentials.id, webhookSecretCredentialId),
        eq(tables.integrationCredentials.organizationId, organizationId),
        isNull(tables.integrationCredentials.revokedAt),
      ),
    )
    .limit(1);

  if (credential === undefined) {
    throw new Error(
      `Webhook secret credential '${webhookSecretCredentialId}' for source '${input.source.id}' was not found.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: credential.organizationCredentialKeyMasterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: credential.organizationCredentialKeyCiphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return {
      webhookSecret: decryptCredentialUtf8({
        nonce: credential.credentialNonce,
        ciphertext: credential.credentialCiphertext,
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      }),
    };
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

async function resolveWebhookSourceForPreVerificationOrThrow(input: {
  db: AppContext["var"]["db"];
  targetKey: string;
  endpointKey: string;
}): Promise<IntegrationWebhookSource> {
  const source = await input.db.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.targetKey, input.targetKey),
        eq(table.endpointKey, input.endpointKey),
        eq(table.status, IntegrationWebhookSourceStatuses.ACTIVE),
      ),
  });

  if (source === undefined) {
    throw new NotFoundError(
      IntegrationWebhooksNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
      `Active webhook source '${input.endpointKey}' was not found for target '${input.targetKey}'.`,
    );
  }

  return source;
}

async function resolveConnectionOwnedWebhookSecrets(input: {
  db: AppContext["var"]["db"];
  integrationRegistry: AppContext["var"]["integrationRegistry"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connectionId: string;
}): Promise<Record<string, string>> {
  const connectionWithTarget = await resolveConnectionWithTargetOrThrow({
    db: input.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const connectionConfig = connectionWithTarget.config;
  if (connectionConfig === null) {
    return {};
  }

  const connectionMethodId = connectionConfig["connection_method"];
  if (typeof connectionMethodId !== "string" || connectionMethodId.length === 0) {
    return {};
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: connectionWithTarget.target.familyId,
    variantId: connectionWithTarget.target.variantId,
  });
  if (definition === undefined) {
    throw new Error(
      `Integration definition '${connectionWithTarget.target.familyId}/${connectionWithTarget.target.variantId}' is not registered.`,
    );
  }

  const connectionMethod = definition.connectionMethods.find(
    (method) => method.id === connectionMethodId,
  );
  if (connectionMethod === undefined || connectionMethod.kind !== "form") {
    return {};
  }

  return resolveConnectionSecretsOrThrow({
    db: input.db,
    integrationRegistry: input.integrationRegistry,
    connection: connectionWithTarget,
    integrationsConfig: input.integrationsConfig,
  });
}

async function resolveWebhookSourceContext(input: {
  db: AppContext["var"]["db"];
  integrationRegistry: AppContext["var"]["integrationRegistry"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  targetKey: string;
  endpointKey: string;
}): Promise<ResolvedWebhookSourceContext> {
  const webhookSource = await resolveWebhookSourceForPreVerificationOrThrow({
    db: input.db,
    targetKey: input.targetKey,
    endpointKey: input.endpointKey,
  });
  const webhookSourceSecrets = await resolveWebhookSourceSecretOrThrow({
    db: input.db,
    source: webhookSource,
    integrationsConfig: input.integrationsConfig,
  });
  const activeConnections = await input.db.query.integrationConnections.findMany({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.targetKey, input.targetKey),
        whereEq(table.id, webhookSource.integrationConnectionId),
        whereEq(table.status, IntegrationConnectionStatuses.ACTIVE),
      ),
    columns: {
      id: true,
      organizationId: true,
      status: true,
      externalSubjectId: true,
      config: true,
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

  return {
    activeConnections,
    activeConnectionsById,
    webhookConnections,
    webhookSource,
    webhookSourceSecrets,
  };
}

async function resolveConnectionSecretsForWebhookRequest(input: {
  activeConnectionsById: ReadonlyMap<string, ActiveWebhookConnection>;
  connectionId: string;
  db: AppContext["var"]["db"];
  integrationRegistry: AppContext["var"]["integrationRegistry"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<Record<string, string>> {
  const activeConnection = input.activeConnectionsById.get(input.connectionId);
  if (activeConnection === undefined) {
    assertConnectionCandidateExistsOrThrow({
      connectionId: input.connectionId,
      connectionsById: input.activeConnectionsById,
    });
    throw new Error(`Expected active webhook connection '${input.connectionId}' to exist.`);
  }

  return resolveConnectionOwnedWebhookSecrets({
    db: input.db,
    integrationRegistry: input.integrationRegistry,
    integrationsConfig: input.integrationsConfig,
    organizationId: activeConnection.organizationId,
    connectionId: input.connectionId,
  });
}

async function createWebhookMiddlewareContext(input: {
  activeConnection: ActiveWebhookConnection;
  db: AppContext["var"]["db"];
  endpointKey: string;
  integrationRegistry: AppContext["var"]["integrationRegistry"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  normalizedHeaders: Record<string, string>;
  rawBody: Uint8Array;
  resolvedSourceContext: ResolvedWebhookSourceContext;
  resolvedTarget: IntegrationWebhookMiddlewareBaseContext["target"];
  targetKey: string;
}): Promise<IntegrationWebhookMiddlewareBaseContext> {
  const connection = toWebhookConnectionOrThrow({
    targetKey: input.targetKey,
    connection: input.activeConnection,
  });
  const connectionSecrets = await resolveConnectionSecretsForWebhookRequest({
    activeConnectionsById: input.resolvedSourceContext.activeConnectionsById,
    connectionId: connection.id,
    db: input.db,
    integrationRegistry: input.integrationRegistry,
    integrationsConfig: input.integrationsConfig,
  });

  return {
    request: createIntegrationWebhookRequestSnapshot({
      targetKey: input.targetKey,
      endpointKey: input.endpointKey,
      headers: input.normalizedHeaders,
      rawBody: input.rawBody,
    }),
    organizationId: input.activeConnection.organizationId,
    target: input.resolvedTarget,
    connection: {
      ...connection,
      secrets: connectionSecrets,
    },
    webhookSource: {
      id: input.resolvedSourceContext.webhookSource.id,
      endpointKey: input.resolvedSourceContext.webhookSource.endpointKey,
      providerMetadata: input.resolvedSourceContext.webhookSource.providerMetadata,
      secrets: input.resolvedSourceContext.webhookSourceSecrets,
    },
  };
}

export async function receiveIntegrationWebhook(
  {
    db,
    integrationRegistry,
    integrationsConfig,
  }: {
    db: AppContext["var"]["db"];
    integrationRegistry: AppContext["var"]["integrationRegistry"];
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: ReceiveIntegrationWebhookInput,
): Promise<ReceivedIntegrationWebhook> {
  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
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
  if (definition.webhookSource === undefined) {
    throw new Error(
      `Integration '${target.familyId}/${target.variantId}' does not define webhookSource capability.`,
    );
  }

  const normalizedHeaders = normalizeWebhookHeaders(input.headers);
  const resolvedTarget = {
    targetKey: input.targetKey,
    familyId: target.familyId,
    variantId: target.variantId,
    enabled: target.enabled,
    config: parsedTargetConfig,
    secrets: parsedTargetSecrets,
  };
  const webhookHandler = getWebhookHandlerOrThrow(definition);
  const webhookMiddleware = definition.webhookMiddleware ?? [];
  let resolvedSourceContext: ResolvedWebhookSourceContext | undefined;
  let webhookRequest: IntegrationWebhookRequestResolution;

  if (webhookMiddleware.length > 0) {
    resolvedSourceContext = await resolveWebhookSourceContext({
      db,
      endpointKey: input.endpointKey,
      integrationRegistry,
      integrationsConfig,
      targetKey: input.targetKey,
    });
    const sourceConnection = resolvedSourceContext.activeConnections[0];
    if (sourceConnection === undefined) {
      throw new NotFoundError(
        IntegrationWebhooksNotFoundCodes.CONNECTION_NOT_FOUND,
        `Active webhook connection '${resolvedSourceContext.webhookSource.integrationConnectionId}' was not found for target '${input.targetKey}'.`,
      );
    }

    const middlewareContext = await createWebhookMiddlewareContext({
      activeConnection: sourceConnection,
      db,
      endpointKey: input.endpointKey,
      integrationRegistry,
      integrationsConfig,
      normalizedHeaders,
      rawBody: input.rawBody,
      resolvedSourceContext,
      resolvedTarget,
      targetKey: input.targetKey,
    });
    const middlewareResult = await withIntegrationWebhookSpan(
      {
        name: "integration_webhook.middleware",
        telemetryContext: {
          endpointKey: input.endpointKey,
          targetKey: input.targetKey,
        },
      },
      async (span) => {
        try {
          const result = await runIntegrationWebhookMiddleware({
            middleware: webhookMiddleware,
            context: middlewareContext,
            next: async () =>
              webhookHandler.resolveWebhookRequest({
                targetKey: input.targetKey,
                target: resolvedTarget,
                headers: normalizedHeaders,
                rawBody: input.rawBody,
              }),
          });

          span.addEvent("integration_webhook.middleware_succeeded");
          return result;
        } catch (error) {
          span.addEvent("integration_webhook.middleware_failed", {
            "mistle.error.message": error instanceof Error ? error.message : String(error),
          });

          if (error instanceof IntegrationWebhookError) {
            throwMappedWebhookError(error);
          }

          throw error;
        }
      },
    );

    if (middlewareResult.kind === "short-circuited") {
      return {
        kind: "response",
        response: middlewareResult.response,
      };
    }

    webhookRequest = middlewareResult.result;
  } else {
    webhookRequest = await webhookHandler.resolveWebhookRequest({
      targetKey: input.targetKey,
      target: resolvedTarget,
      headers: normalizedHeaders,
      rawBody: input.rawBody,
    });
  }

  if (webhookRequest.kind === "response" && webhookRequest.verification === "skip") {
    if (webhookMiddleware.length === 0) {
      await resolveWebhookSourceForPreVerificationOrThrow({
        db,
        targetKey: input.targetKey,
        endpointKey: input.endpointKey,
      });
    }

    return {
      kind: "response",
      response: webhookRequest.response,
    };
  }

  resolvedSourceContext ??= await resolveWebhookSourceContext({
    db,
    endpointKey: input.endpointKey,
    integrationRegistry,
    integrationsConfig,
    targetKey: input.targetKey,
  });
  const { activeConnectionsById, webhookConnections, webhookSource, webhookSourceSecrets } =
    resolvedSourceContext;

  const resolvedWebhookRequest = await withIntegrationWebhookSpan(
    {
      name: "integration_webhook.verify_and_resolve",
      telemetryContext: {
        endpointKey: input.endpointKey,
        targetKey: input.targetKey,
      },
    },
    async (span) => {
      try {
        const verifiedWebhookRequest = await verifyAndResolveWebhookRequestOrThrow({
          definition,
          targetKey: input.targetKey,
          target: resolvedTarget,
          connections: webhookConnections,
          resolveConnectionSecrets: ({ connectionId }) =>
            resolveConnectionSecretsForWebhookRequest({
              activeConnectionsById,
              connectionId,
              db,
              integrationRegistry,
              integrationsConfig,
            }),
          webhookSourceSecrets,
          webhookRequest,
          headers: normalizedHeaders,
          rawBody: input.rawBody,
        });

        span.addEvent("integration_webhook.verification_succeeded");

        return verifiedWebhookRequest;
      } catch (error) {
        span.addEvent("integration_webhook.verification_failed", {
          "mistle.error.message": error instanceof Error ? error.message : String(error),
        });

        if (error instanceof IntegrationWebhookError) {
          throwMappedWebhookError(error);
        }

        throw error;
      }
    },
  );

  if (resolvedWebhookRequest.kind === "response") {
    return {
      kind: "response",
      response: resolvedWebhookRequest.response,
    };
  }

  const resolvedConnection = activeConnectionsById.get(resolvedWebhookRequest.connectionId);
  if (resolvedConnection === undefined) {
    throw new Error(
      `Expected resolved webhook connection '${resolvedWebhookRequest.connectionId}' to exist in active connection candidates.`,
    );
  }

  const resolvedActingUser = await resolveWebhookActingUser(
    {
      db,
    },
    {
      organizationId: resolvedConnection.organizationId,
      webhookConnectionId: resolvedConnection.id,
      providerFamily: target.familyId,
      definition,
      target: resolvedTarget,
      event: resolvedWebhookRequest.event,
    },
  );

  const insertedRows = await withIntegrationWebhookSpan(
    {
      name: "integration_webhook.persist",
      telemetryContext: {
        endpointKey: input.endpointKey,
        externalDeliveryId: resolvedWebhookRequest.event.externalDeliveryId ?? undefined,
        integrationConnectionId: resolvedConnection.id,
        targetKey: input.targetKey,
      },
    },
    async (span) => {
      const tables = getControlPlaneDatabaseSchema(db);

      span.setAttribute("mistle.webhook.event_type", resolvedWebhookRequest.event.eventType);

      const persistedRows = await db
        .insert(tables.integrationWebhookEvents)
        .values({
          organizationId: resolvedConnection.organizationId,
          integrationConnectionId: resolvedConnection.id,
          integrationWebhookSourceId: webhookSource.id,
          targetKey: input.targetKey,
          externalEventId: resolvedWebhookRequest.event.externalEventId,
          externalDeliveryId: resolvedWebhookRequest.event.externalDeliveryId,
          eventType: resolvedWebhookRequest.event.eventType,
          providerEventType: resolvedWebhookRequest.event.providerEventType,
          payload: resolvedWebhookRequest.event.payload,
          sourceOccurredAt: resolvedWebhookRequest.event.occurredAt,
          sourceOrderKey: resolvedWebhookRequest.event.sourceOrderKey,
          status: IntegrationWebhookEventStatuses.RECEIVED,
          ...(resolvedActingUser === null
            ? {}
            : {
                resolvedUserId: resolvedActingUser.userId,
                resolvedPrincipalId: resolvedActingUser.principalId,
              }),
        })
        .onConflictDoNothing({
          target: [
            tables.integrationWebhookEvents.integrationWebhookSourceId,
            tables.integrationWebhookEvents.externalEventId,
          ],
        })
        .returning({
          id: tables.integrationWebhookEvents.id,
        });

      const insertedWebhookEvent = persistedRows[0];
      const persistedWebhookEventId =
        insertedWebhookEvent?.id ??
        (
          await db.query.integrationWebhookEvents.findFirst({
            columns: {
              id: true,
            },
            where: (table, { and: whereAnd, eq: whereEq }) =>
              whereAnd(
                whereEq(table.integrationWebhookSourceId, webhookSource.id),
                whereEq(table.externalEventId, resolvedWebhookRequest.event.externalEventId),
              ),
          })
        )?.id;

      if (persistedWebhookEventId !== undefined) {
        span.setAttribute("mistle.webhook.event_id", persistedWebhookEventId);
      }

      if (insertedWebhookEvent !== undefined) {
        span.addEvent("integration_webhook.persisted", {
          "mistle.webhook.event_id": persistedWebhookEventId ?? insertedWebhookEvent.id,
        });

        logIntegrationWebhookEvent({
          eventName: "webhook.persisted",
          message: "Persisted inbound integration webhook event",
          telemetryContext: {
            webhookEventId: persistedWebhookEventId ?? insertedWebhookEvent.id,
            externalDeliveryId: resolvedWebhookRequest.event.externalDeliveryId ?? undefined,
            integrationConnectionId: resolvedConnection.id,
            targetKey: input.targetKey,
          },
        });
      }

      return {
        insertedWebhookEventId: insertedWebhookEvent?.id,
        persistedWebhookEventId,
      };
    },
  );

  return {
    kind: "accepted",
    duplicate: insertedRows.insertedWebhookEventId === undefined,
    externalDeliveryId: resolvedWebhookRequest.event.externalDeliveryId ?? null,
    integrationConnectionId: resolvedConnection.id,
    targetKey: input.targetKey,
    ...(insertedRows.persistedWebhookEventId === undefined
      ? {}
      : { webhookEventId: insertedRows.persistedWebhookEventId }),
  };
}
