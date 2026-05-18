import {
  IntegrationConnectionStatuses,
  IntegrationWebhookSourceStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type {
  IntegrationRegistry,
  IntegrationWebhookEventDefinition,
} from "@mistle/integrations-core";

import { TriggerWebhooksBadRequestCodes } from "../constants.js";

export type ResolvedWebhookSourceReference = {
  webhookSourceId: string;
  integrationConnectionId: string;
  providerMetadata: Record<string, unknown>;
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
};

export async function assertWebhookSourceReferenceOrThrow(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    integrationWebhookSourceId: string;
  },
): Promise<ResolvedWebhookSourceReference> {
  const webhookSource = await ctx.db.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.integrationWebhookSourceId),
        eq(table.organizationId, input.organizationId),
        eq(table.status, IntegrationWebhookSourceStatuses.ACTIVE),
      ),
  });

  if (webhookSource === undefined) {
    throw new BadRequestError(
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_SOURCE_REFERENCE,
      "Webhook source must reference an active source in the active organization.",
    );
  }

  const integrationConnectionId = webhookSource.integrationConnectionId;

  const connection = await ctx.db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, integrationConnectionId),
        eq(table.organizationId, input.organizationId),
        eq(table.status, IntegrationConnectionStatuses.ACTIVE),
      ),
  });

  if (connection === undefined) {
    throw new BadRequestError(
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_SOURCE_REFERENCE,
      "Webhook source must reference an active integration connection in the active organization.",
    );
  }

  const target = await ctx.db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(`Integration target '${connection.targetKey}' was not found.`);
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

  if (definition.webhookHandler === undefined) {
    throw new BadRequestError(
      TriggerWebhooksBadRequestCodes.WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE,
      "Webhook source target does not define webhook handling.",
    );
  }

  return {
    webhookSourceId: webhookSource.id,
    integrationConnectionId: connection.id,
    providerMetadata: webhookSource.providerMetadata,
    supportedWebhookEvents: definition.supportedWebhookEvents ?? [],
  };
}
