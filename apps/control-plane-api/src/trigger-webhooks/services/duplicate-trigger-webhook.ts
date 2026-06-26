import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { createTriggerWebhook } from "./create-trigger-webhook.js";
import { loadWebhookTriggerAggregateOrThrow } from "./load-webhook-trigger-aggregate-or-throw.js";

export async function duplicateTriggerWebhook(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    triggerId: string;
  },
) {
  const sourceTrigger = await loadWebhookTriggerAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      triggerId: input.triggerId,
    },
  );

  return await createTriggerWebhook(ctx, {
    organizationId: input.organizationId,
    name: `${sourceTrigger.name} copy`,
    enabled: false,
    integrationWebhookSourceId: sourceTrigger.integrationWebhookSourceId,
    eventConditions: sourceTrigger.eventConditions,
    inputTemplate: sourceTrigger.inputTemplate,
    instructions: sourceTrigger.instructions,
    conversationKeyTemplate: sourceTrigger.conversationKeyTemplate,
    idempotencyKeyTemplate: sourceTrigger.idempotencyKeyTemplate,
    target: {
      sandboxProfileId: sourceTrigger.target.sandboxProfileId,
      sandboxProfileVersion: sourceTrigger.target.sandboxProfileVersion,
      primaryRepositoryId: sourceTrigger.target.primaryRepositoryId,
    },
  });
}
