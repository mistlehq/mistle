import { randomUUID } from "node:crypto";

import type { Cache } from "@mistle/cache";
import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import { IntegrationBindingKinds, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import { mintConnectionToken as mintGatewayConnectionToken } from "@mistle/gateway-connection-auth";
import {
  getSandboxDeliveryDisposition,
  SandboxDeliveryDispositions,
} from "@mistle/sandbox-lifecycle";
import { systemClock, systemSleeper } from "@mistle/time";

import { logger } from "../../../logger.js";
import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../../../sandbox-instances/errors.js";
import { readProfileVersionGitCommitSigningIntegrationConnectionId } from "../../../sandbox-profiles/services/profile-version-git-signing-selector.js";
import { resolveActingUserGitIdentity } from "../../../sandbox-profiles/services/resolve-acting-user-git-identity.js";
import { withSandboxRuntimeSpan } from "../telemetry.js";

const ConnectionWaitTimeoutMs = 30_000;
const ConnectionWaitPollIntervalMs = 250;

type ExistingSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function createConnectionUrl(input: {
  gatewayWebsocketUrl: string;
  sandboxInstanceId: string;
  token: string;
}): string {
  const gatewayUrl = new URL(input.gatewayWebsocketUrl);
  gatewayUrl.pathname = `${trimTrailingSlash(gatewayUrl.pathname)}/${encodeURIComponent(input.sandboxInstanceId)}`;
  gatewayUrl.searchParams.set("connect_token", input.token);

  return gatewayUrl.toString();
}

function createExpirationIso(ttlSeconds: number): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("Connection token ttlSeconds must be an integer greater than or equal to 1.");
  }

  const expiresAtEpochMilliseconds = Date.now() + ttlSeconds * 1000;
  return new Date(expiresAtEpochMilliseconds).toISOString();
}

function createTokenJti(instanceId: string): string {
  return `${instanceId}-${randomUUID()}`;
}

function createSandboxInstanceNotFoundError(instanceId: string): SandboxInstancesNotFoundError {
  return new SandboxInstancesNotFoundError(
    SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
    `Sandbox instance '${instanceId}' was not found.`,
  );
}

function createInstanceFailedError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "failureMessage">,
): SandboxInstancesConflictError {
  const failureMessage =
    sandboxInstance.failureMessage === null
      ? `Sandbox instance '${sandboxInstance.id}' failed and cannot be connected.`
      : `Sandbox instance '${sandboxInstance.id}' failed and cannot be connected: ${sandboxInstance.failureMessage}`;

  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    failureMessage,
  );
}

function createInstanceNotResumableError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' did not become running before the connect wait timed out.`,
  );
}

function createInstanceNotDeliverableError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "status">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' is '${sandboxInstance.status}' and cannot receive a connection token.`,
  );
}

async function getExistingSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<ExistingSandboxInstance> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw createSandboxInstanceNotFoundError(input.instanceId);
  }

  return sandboxInstance;
}

async function waitForRunningSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<ExistingSandboxInstance> {
  return await withSandboxRuntimeSpan(
    {
      name: "sandbox_runtime.connection.wait_running",
      telemetryContext: {
        sandboxInstanceId: input.instanceId,
      },
    },
    async (span) => {
      const waitStartedAt = systemClock.nowMs();
      const deadlineMs = waitStartedAt + ConnectionWaitTimeoutMs;
      let pollCount = 0;

      while (true) {
        const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, input);
        pollCount += 1;

        span.setAttributes({
          "mistle.sandbox.poll_count": pollCount,
          "mistle.sandbox.status": sandboxInstance.status,
        });

        const disposition = getSandboxDeliveryDisposition(sandboxInstance.status);

        if (disposition === SandboxDeliveryDispositions.DELIVER) {
          span.setAttribute("mistle.sandbox.wait_ms", systemClock.nowMs() - waitStartedAt);
          logger.info(
            {
              eventName: "sandbox.running",
              "mistle.sandbox.instance_id": input.instanceId,
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.wait_ms": systemClock.nowMs() - waitStartedAt,
            },
            "Sandbox instance became running while minting a connection token",
          );
          return sandboxInstance;
        }

        if (disposition === SandboxDeliveryDispositions.RECOVER) {
          throw createInstanceFailedError(sandboxInstance);
        }

        if (disposition === SandboxDeliveryDispositions.NON_DELIVERABLE) {
          throw createInstanceNotDeliverableError(sandboxInstance);
        }

        const remainingMs = deadlineMs - systemClock.nowMs();
        if (remainingMs <= 0) {
          throw createInstanceNotResumableError(sandboxInstance);
        }

        await systemSleeper.sleep(Math.min(remainingMs, ConnectionWaitPollIntervalMs));
      }
    },
  );
}

export async function mintConnectionToken(
  {
    db,
    cache,
    integrationsConfig,
    dataPlaneClient,
    gatewayWebsocketUrl,
    tokenTtlSeconds,
    tokenConfig,
  }: {
    db: ControlPlaneDatabase;
    cache: Cache;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "resumeSandboxInstance"
    >;
    gatewayWebsocketUrl: string;
    tokenTtlSeconds: number;
    tokenConfig: ConnectionTokenConfig;
  },
  input: {
    organizationId: string;
    instanceId: string;
    actingUserId?: string;
    webhookEventId?: string;
    deliveryTaskId?: string;
    externalDeliveryId?: string;
    triggerRunId?: string;
    conversationId?: string;
  },
): Promise<{
  instanceId: string;
  tokenJti: string;
  url: string;
  token: string;
  expiresAt: string;
}> {
  return await withSandboxRuntimeSpan(
    {
      name: "sandbox_runtime.connection.mint",
      telemetryContext: {
        sandboxInstanceId: input.instanceId,
      },
    },
    async (span) => {
      logger.info(
        {
          eventName: "connection_token.mint_started",
          ...(input.webhookEventId === undefined
            ? {}
            : { "mistle.webhook.event_id": input.webhookEventId }),
          ...(input.deliveryTaskId === undefined
            ? {}
            : { "mistle.delivery.task_id": input.deliveryTaskId }),
          ...(input.externalDeliveryId === undefined
            ? {}
            : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
          ...(input.triggerRunId === undefined
            ? {}
            : { "mistle.trigger.run_id": input.triggerRunId }),
          ...(input.conversationId === undefined
            ? {}
            : { "mistle.conversation.id": input.conversationId }),
          "mistle.sandbox.instance_id": input.instanceId,
        },
        "Minting sandbox connection token",
      );

      const mintStartedAt = systemClock.nowMs();

      try {
        let sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
          organizationId: input.organizationId,
          instanceId: input.instanceId,
        });

        switch (getSandboxDeliveryDisposition(sandboxInstance.status)) {
          case SandboxDeliveryDispositions.DELIVER:
            break;
          case SandboxDeliveryDispositions.WAIT:
            sandboxInstance = await waitForRunningSandboxInstance(dataPlaneClient, {
              organizationId: input.organizationId,
              instanceId: input.instanceId,
            });
            break;
          case SandboxDeliveryDispositions.RESUME:
            if (isTriggerDeliveryConnectionMint(input)) {
              throw createInstanceNotResumableError(sandboxInstance);
            }
            logger.info(
              {
                eventName: "sandbox.resume_requested",
                "mistle.sandbox.instance_id": input.instanceId,
              },
              "Requested sandbox resume while minting a connection token",
            );

            const gitIdentity = await resolveActingUserGitIdentityForSandboxInstance(
              {
                db,
                cache,
                integrationsConfig,
              },
              {
                organizationId: input.organizationId,
                sandboxInstance,
                ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
              },
            );

            await dataPlaneClient.resumeSandboxInstance({
              organizationId: input.organizationId,
              instanceId: input.instanceId,
              ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
              ...(gitIdentity === undefined ? {} : { gitIdentity }),
            });
            sandboxInstance = await waitForRunningSandboxInstance(dataPlaneClient, {
              organizationId: input.organizationId,
              instanceId: input.instanceId,
            });
            break;
          case SandboxDeliveryDispositions.RECOVER:
            throw createInstanceFailedError(sandboxInstance);
          case SandboxDeliveryDispositions.NON_DELIVERABLE:
            throw createInstanceNotDeliverableError(sandboxInstance);
        }

        const tokenJti = createTokenJti(sandboxInstance.id);
        const token = await mintGatewayConnectionToken({
          config: tokenConfig,
          jti: tokenJti,
          sandboxInstanceId: sandboxInstance.id,
          ttlSeconds: tokenTtlSeconds,
        });
        const mintDurationMs = systemClock.nowMs() - mintStartedAt;

        span.setAttributes({
          "mistle.connection.mint_ms": mintDurationMs,
          "mistle.connection.token_jti": tokenJti,
          ...(input.webhookEventId === undefined
            ? {}
            : { "mistle.webhook.event_id": input.webhookEventId }),
          ...(input.deliveryTaskId === undefined
            ? {}
            : { "mistle.delivery.task_id": input.deliveryTaskId }),
          ...(input.externalDeliveryId === undefined
            ? {}
            : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
          ...(input.triggerRunId === undefined
            ? {}
            : { "mistle.trigger.run_id": input.triggerRunId }),
          ...(input.conversationId === undefined
            ? {}
            : { "mistle.conversation.id": input.conversationId }),
        });
        logger.info(
          {
            eventName: "connection_token.minted",
            "mistle.connection.mint_ms": mintDurationMs,
            "mistle.connection.token_jti": tokenJti,
            ...(input.webhookEventId === undefined
              ? {}
              : { "mistle.webhook.event_id": input.webhookEventId }),
            ...(input.deliveryTaskId === undefined
              ? {}
              : { "mistle.delivery.task_id": input.deliveryTaskId }),
            ...(input.externalDeliveryId === undefined
              ? {}
              : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
            ...(input.triggerRunId === undefined
              ? {}
              : { "mistle.trigger.run_id": input.triggerRunId }),
            ...(input.conversationId === undefined
              ? {}
              : { "mistle.conversation.id": input.conversationId }),
            "mistle.sandbox.instance_id": sandboxInstance.id,
          },
          "Minted sandbox connection token",
        );

        return {
          instanceId: sandboxInstance.id,
          tokenJti,
          url: createConnectionUrl({
            gatewayWebsocketUrl,
            sandboxInstanceId: sandboxInstance.id,
            token,
          }),
          token,
          expiresAt: createExpirationIso(tokenTtlSeconds),
        };
      } catch (error) {
        logger.error(
          {
            err: error,
            eventName: "connection_token.failed",
            ...(input.webhookEventId === undefined
              ? {}
              : { "mistle.webhook.event_id": input.webhookEventId }),
            ...(input.deliveryTaskId === undefined
              ? {}
              : { "mistle.delivery.task_id": input.deliveryTaskId }),
            ...(input.externalDeliveryId === undefined
              ? {}
              : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
            ...(input.triggerRunId === undefined
              ? {}
              : { "mistle.trigger.run_id": input.triggerRunId }),
            ...(input.conversationId === undefined
              ? {}
              : { "mistle.conversation.id": input.conversationId }),
            "mistle.sandbox.instance_id": input.instanceId,
          },
          "Failed to mint sandbox connection token",
        );
        throw error;
      }
    },
  );
}

function isTriggerDeliveryConnectionMint(input: {
  webhookEventId?: string;
  deliveryTaskId?: string;
  externalDeliveryId?: string;
  triggerRunId?: string;
  conversationId?: string;
}): boolean {
  return (
    input.webhookEventId !== undefined ||
    input.deliveryTaskId !== undefined ||
    input.externalDeliveryId !== undefined ||
    input.triggerRunId !== undefined ||
    input.conversationId !== undefined
  );
}

async function resolveActingUserGitIdentityForSandboxInstance(
  ctx: {
    db: ControlPlaneDatabase;
    cache: Cache;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    actingUserId?: string;
    sandboxInstance: Pick<ExistingSandboxInstance, "sandboxProfileId" | "sandboxProfileVersion">;
  },
) {
  const gitIntegrationConnectionId = await readProfileVersionGitIntegrationConnectionId(ctx.db, {
    profileId: input.sandboxInstance.sandboxProfileId,
    profileVersion: input.sandboxInstance.sandboxProfileVersion,
  });
  if (gitIntegrationConnectionId === null) {
    return undefined;
  }
  const gitCommitSigningIntegrationConnectionId =
    await readProfileVersionGitCommitSigningIntegrationConnectionId(ctx.db, {
      profileId: input.sandboxInstance.sandboxProfileId,
      profileVersion: input.sandboxInstance.sandboxProfileVersion,
    });

  return await resolveActingUserGitIdentity(ctx.db, {
    cache: ctx.cache,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: input.organizationId,
    gitIntegrationConnectionId,
    gitCommitSigningIntegrationConnectionId,
    ...(input.actingUserId === undefined
      ? {}
      : {
          actingUser: {
            userId: input.actingUserId,
          },
        }),
  });
}

async function readProfileVersionGitIntegrationConnectionId(
  db: ControlPlaneDatabase,
  input: {
    profileId: string;
    profileVersion: number;
  },
): Promise<string | null> {
  const gitBinding = await db.query.sandboxProfileVersionIntegrationBindings.findFirst({
    columns: {
      connectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
        eq(table.kind, IntegrationBindingKinds.GIT),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  return gitBinding?.connectionId ?? null;
}
