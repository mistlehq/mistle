import {
  IntegrationConnectionStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";
import { assertWebhookCapableTargetDefinition } from "./assert-webhook-capable-target-definition.js";

export async function assertWebhookConnectionReferenceOrThrow(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    integrationConnectionId: string;
  },
): Promise<void> {
  const connection = await ctx.db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.integrationConnectionId),
        eq(table.organizationId, input.organizationId),
        eq(table.status, IntegrationConnectionStatuses.ACTIVE),
      ),
  });

  if (connection === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.INVALID_CONNECTION_REFERENCE,
      "Integration connection must reference an active connection in the active organization.",
    );
  }

  const target = await ctx.db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(`Integration target '${connection.targetKey}' was not found.`);
  }

  const webhookTarget = assertWebhookCapableTargetDefinition(ctx.integrationRegistry, {
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (!webhookTarget.supportsWebhookHandling) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE,
      "Integration connection target does not define webhook handling.",
    );
  }
}
