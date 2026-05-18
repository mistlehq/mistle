import {
  TriggerKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

export type TriggerWebhookAggregate = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  integrationWebhookSourceId: string;
  eventTypes: string[] | null;
  payloadFilter: Record<string, unknown> | null;
  inputTemplate: string;
  instructions: string | null;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  target: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
};

export async function loadWebhookTriggerAggregateOrThrow(
  ctx: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    triggerId: string;
  },
): Promise<TriggerWebhookAggregate> {
  const trigger = await ctx.db.query.triggers.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.triggerId),
        eq(table.organizationId, input.organizationId),
        eq(table.kind, TriggerKinds.WEBHOOK),
      ),
  });

  if (trigger === undefined) {
    throw new NotFoundError("NOT_FOUND", "Webhook trigger was not found.");
  }

  const [webhookTrigger, targets] = await Promise.all([
    ctx.db.query.webhookTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, trigger.id),
    }),
    ctx.db.query.triggerTargets.findMany({
      where: (table, { eq }) => eq(table.triggerId, trigger.id),
    }),
  ]);

  if (webhookTrigger === undefined) {
    throw new Error(`Webhook trigger '${trigger.id}' is missing its webhook configuration row.`);
  }

  if (targets.length !== 1 || targets[0] === undefined) {
    throw new Error(`Webhook trigger '${trigger.id}' must have exactly one trigger target.`);
  }

  const target = targets[0];

  return {
    id: trigger.id,
    name: trigger.name,
    enabled: trigger.enabled,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
    integrationWebhookSourceId: webhookTrigger.integrationWebhookSourceId,
    eventTypes: webhookTrigger.eventTypes,
    payloadFilter: webhookTrigger.payloadFilter,
    inputTemplate: webhookTrigger.inputTemplate,
    instructions: webhookTrigger.instructions,
    conversationKeyTemplate: webhookTrigger.conversationKeyTemplate,
    idempotencyKeyTemplate: webhookTrigger.idempotencyKeyTemplate,
    target: {
      id: target.id,
      sandboxProfileId: target.sandboxProfileId,
      sandboxProfileVersion: target.sandboxProfileVersion,
      primaryRepositoryId: target.primaryRepositoryId,
    },
  };
}
