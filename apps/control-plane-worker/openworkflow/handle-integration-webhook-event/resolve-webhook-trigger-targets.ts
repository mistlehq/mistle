import {
  TriggerKinds,
  type ControlPlaneDatabase,
  type WebhookTriggerEventCondition,
} from "@mistle/db/control-plane";
import type {
  IntegrationRegistry,
  IntegrationWebhookEventActorDefinition,
} from "@mistle/integrations-core";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

import { logWebhookDeliveryEvent } from "../shared/webhook-delivery-telemetry.js";
import { evaluateWebhookPayloadFilter } from "../shared/webhook-payload-filter-evaluator.js";
import {
  resolveWebhookTriggerActorPolicy,
  type ResolvedWebhookTriggerActorPolicyResult,
} from "./resolve-webhook-trigger-actor-policy.js";

type ResolveWebhookTriggerTargetsInput = {
  organizationId: string;
  integrationConnectionId: string;
  integrationWebhookSourceId: string;
  targetKey: string;
  webhookEventId: string;
  externalDeliveryId: string | null;
  integrationRegistry: IntegrationRegistry;
  eventType: string;
  payload: Record<string, unknown>;
};

export type ResolvedWebhookTriggerTarget = {
  triggerId: string;
  triggerTargetId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  conversationKeyTemplate: string;
};

async function isWebhookTriggerMatched(input: {
  db: ControlPlaneDatabase;
  integrationConnectionId: string;
  actorDefinition: IntegrationWebhookEventActorDefinition | undefined;
  eventType: string;
  payload: Record<string, unknown>;
  triggerId: string;
  webhookEventId: string;
  externalDeliveryId: string | null;
  targetKey: string;
  eventConditions: readonly WebhookTriggerEventCondition[];
}): Promise<boolean> {
  for (const condition of input.eventConditions) {
    if (condition.eventType !== input.eventType) {
      continue;
    }

    if (condition.payloadFilter === undefined || condition.payloadFilter === null) {
      const actorPolicyMatched = await isActorPolicyMatched({
        db: input.db,
        integrationConnectionId: input.integrationConnectionId,
        actorDefinition: input.actorDefinition,
        actorPolicy: condition.actorPolicy,
        payload: input.payload,
        triggerId: input.triggerId,
        webhookEventId: input.webhookEventId,
        externalDeliveryId: input.externalDeliveryId,
        targetKey: input.targetKey,
      });
      if (actorPolicyMatched) {
        return true;
      }
      continue;
    }

    const filter = parseWebhookPayloadFilter(condition.payloadFilter);
    if (
      evaluateWebhookPayloadFilter({
        filter,
        payload: input.payload,
      })
    ) {
      const actorPolicyMatched = await isActorPolicyMatched({
        db: input.db,
        integrationConnectionId: input.integrationConnectionId,
        actorDefinition: input.actorDefinition,
        actorPolicy: condition.actorPolicy,
        payload: input.payload,
        triggerId: input.triggerId,
        webhookEventId: input.webhookEventId,
        externalDeliveryId: input.externalDeliveryId,
        targetKey: input.targetKey,
      });
      if (actorPolicyMatched) {
        return true;
      }
    }
  }

  return false;
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
  const enabledCandidateWebhookTriggers = candidateWebhookTriggers.filter((trigger) =>
    enabledTriggersById.has(trigger.triggerId),
  );
  const actorDefinition = hasActorPolicy(enabledCandidateWebhookTriggers)
    ? await resolveWebhookEventActorDefinition({
        db,
        integrationRegistry: input.integrationRegistry,
        targetKey: input.targetKey,
        eventType: input.eventType,
      })
    : undefined;

  const eligibleWebhookTriggers: { triggerId: string; conversationKeyTemplate: string }[] = [];
  for (const candidateWebhookTrigger of enabledCandidateWebhookTriggers) {
    const matched = await isWebhookTriggerMatched({
      db,
      integrationConnectionId: input.integrationConnectionId,
      actorDefinition,
      eventType: input.eventType,
      payload: input.payload,
      triggerId: candidateWebhookTrigger.triggerId,
      webhookEventId: input.webhookEventId,
      externalDeliveryId: input.externalDeliveryId,
      targetKey: input.targetKey,
      eventConditions: candidateWebhookTrigger.eventConditions,
    });
    if (!matched) {
      continue;
    }

    eligibleWebhookTriggers.push({
      triggerId: candidateWebhookTrigger.triggerId,
      conversationKeyTemplate: candidateWebhookTrigger.conversationKeyTemplate,
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
        conversationKeyTemplate: eligibleWebhookTrigger.conversationKeyTemplate,
      });
    }
  }

  return resolvedTargets;
}

function hasActorPolicy(
  webhookTriggers: ReadonlyArray<{
    eventConditions: readonly WebhookTriggerEventCondition[];
  }>,
): boolean {
  return webhookTriggers.some((trigger) =>
    trigger.eventConditions.some((condition) => condition.actorPolicy !== undefined),
  );
}

async function resolveWebhookEventActorDefinition(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  targetKey: string;
  eventType: string;
}): Promise<IntegrationWebhookEventActorDefinition | undefined> {
  const target = await input.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, input.targetKey),
  });
  if (target === undefined) {
    throw new Error(`Integration target '${input.targetKey}' was not found.`);
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
    );
  }

  const eventDefinition = definition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === input.eventType,
  );

  return eventDefinition?.actor;
}

async function isActorPolicyMatched(input: {
  db: ControlPlaneDatabase;
  integrationConnectionId: string;
  actorDefinition: IntegrationWebhookEventActorDefinition | undefined;
  actorPolicy: WebhookTriggerEventCondition["actorPolicy"];
  payload: Record<string, unknown>;
  triggerId: string;
  webhookEventId: string;
  externalDeliveryId: string | null;
  targetKey: string;
}): Promise<boolean> {
  const result = await resolveWebhookTriggerActorPolicy({
    db: input.db,
    connectionId: input.integrationConnectionId,
    actorDefinition: input.actorDefinition,
    actorPolicy: input.actorPolicy,
    payload: input.payload,
  });
  if (result.status === "matched") {
    return true;
  }

  logActorPolicySkipped({
    result,
    triggerId: input.triggerId,
    webhookEventId: input.webhookEventId,
    externalDeliveryId: input.externalDeliveryId,
    integrationConnectionId: input.integrationConnectionId,
    targetKey: input.targetKey,
  });
  return false;
}

function logActorPolicySkipped(input: {
  result: Extract<ResolvedWebhookTriggerActorPolicyResult, { status: "skipped" }>;
  triggerId: string;
  webhookEventId: string;
  externalDeliveryId: string | null;
  integrationConnectionId: string;
  targetKey: string;
}): void {
  logWebhookDeliveryEvent({
    eventName: "trigger_match.actor_policy_skipped",
    message: "Skipped trigger match because the webhook actor policy was not satisfied.",
    telemetryContext: {
      webhookEventId: input.webhookEventId,
      externalDeliveryId: input.externalDeliveryId ?? undefined,
      integrationConnectionId: input.integrationConnectionId,
      targetKey: input.targetKey,
    },
    attributes: {
      "mistle.trigger.id": input.triggerId,
      "mistle.trigger.actor_policy.skip_reason": input.result.reason,
      "mistle.trigger.actor_policy.skip_detail": input.result.detail,
    },
  });
}
