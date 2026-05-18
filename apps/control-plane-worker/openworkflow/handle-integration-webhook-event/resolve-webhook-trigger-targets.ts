import { TriggerKinds, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

import { evaluateWebhookPayloadFilter } from "./evaluator.js";

type ResolveWebhookTriggerTargetsInput = {
  organizationId: string;
  integrationWebhookSourceId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type ResolvedWebhookTriggerTarget = {
  triggerId: string;
  triggerTargetId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
};

function isWebhookTriggerMatched(input: {
  eventType: string;
  payload: Record<string, unknown>;
  eventTypes: ReadonlyArray<string> | null;
  payloadFilter: Record<string, unknown> | null;
}): boolean {
  const { eventType, payload, eventTypes, payloadFilter } = input;

  if (eventTypes !== null && !eventTypes.includes(eventType)) {
    return false;
  }

  if (payloadFilter === null) {
    return true;
  }

  const eventScopedPayloadFilter = payloadFilter[eventType];
  if (eventScopedPayloadFilter === undefined) {
    return true;
  }

  if (
    typeof eventScopedPayloadFilter !== "object" ||
    eventScopedPayloadFilter === null ||
    Array.isArray(eventScopedPayloadFilter)
  ) {
    throw new Error(`Webhook payload filter for event type '${eventType}' must be an object.`);
  }

  const filter = parseWebhookPayloadFilter(eventScopedPayloadFilter);
  return evaluateWebhookPayloadFilter({
    filter,
    payload,
  });
}

export async function resolveWebhookTriggerTargets(
  db: ControlPlaneDatabase,
  input: ResolveWebhookTriggerTargetsInput,
): Promise<ReadonlyArray<ResolvedWebhookTriggerTarget>> {
  const candidateWebhookTriggers = await db.query.webhookTriggers.findMany({
    where: (table, { eq }) =>
      eq(table.integrationWebhookSourceId, input.integrationWebhookSourceId),
  });

  if (candidateWebhookTriggers.length === 0) {
    return [];
  }

  const candidateTriggerIds = candidateWebhookTriggers.map((trigger) => trigger.triggerId);
  const enabledTriggers = await db.query.triggers.findMany({
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.kind, TriggerKinds.WEBHOOK),
        eq(table.enabled, true),
        inArray(table.id, candidateTriggerIds),
      ),
  });
  const enabledTriggersById = new Set(enabledTriggers.map((trigger) => trigger.id));

  const eligibleWebhookTriggers: { triggerId: string }[] = [];
  for (const candidateWebhookTrigger of candidateWebhookTriggers) {
    if (!enabledTriggersById.has(candidateWebhookTrigger.triggerId)) {
      continue;
    }

    const matched = isWebhookTriggerMatched({
      eventType: input.eventType,
      payload: input.payload,
      eventTypes: candidateWebhookTrigger.eventTypes ?? null,
      payloadFilter: candidateWebhookTrigger.payloadFilter ?? null,
    });
    if (!matched) {
      continue;
    }

    eligibleWebhookTriggers.push({
      triggerId: candidateWebhookTrigger.triggerId,
    });
  }

  if (eligibleWebhookTriggers.length === 0) {
    return [];
  }

  const eligibleTriggerIds = eligibleWebhookTriggers.map((trigger) => trigger.triggerId);
  const targetRows = await db.query.triggerTargets.findMany({
    where: (table, { inArray }) => inArray(table.triggerId, eligibleTriggerIds),
  });
  const targetsByTriggerId = new Map<string, typeof targetRows>();
  for (const targetRow of targetRows) {
    const triggerTargets = targetsByTriggerId.get(targetRow.triggerId);
    if (triggerTargets === undefined) {
      targetsByTriggerId.set(targetRow.triggerId, [targetRow]);
      continue;
    }

    triggerTargets.push(targetRow);
  }

  const resolvedTargets: ResolvedWebhookTriggerTarget[] = [];
  for (const eligibleWebhookTrigger of eligibleWebhookTriggers) {
    const triggerTargets = targetsByTriggerId.get(eligibleWebhookTrigger.triggerId);
    if (triggerTargets === undefined) {
      continue;
    }

    for (const triggerTarget of triggerTargets) {
      resolvedTargets.push({
        triggerId: eligibleWebhookTrigger.triggerId,
        triggerTargetId: triggerTarget.id,
        sandboxProfileId: triggerTarget.sandboxProfileId,
        sandboxProfileVersion: triggerTarget.sandboxProfileVersion,
      });
    }
  }

  return resolvedTargets;
}
