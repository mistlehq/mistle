import { AutomationKinds, type ControlPlaneDatabase } from "@mistle/db/control-plane";

import { evaluateWebhookPayloadFilter } from "./evaluator.js";
import { parseWebhookPayloadFilter } from "./schema.js";

type ResolveWebhookAutomationTargetsInput = {
  organizationId: string;
  integrationConnectionId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type ResolvedWebhookAutomationTarget = {
  automationId: string;
  automationTargetId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
};

function isWebhookAutomationMatched(input: {
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

  const filter = parseWebhookPayloadFilter(payloadFilter);
  return evaluateWebhookPayloadFilter({
    filter,
    payload,
  });
}

export async function resolveWebhookAutomationTargets(
  db: ControlPlaneDatabase,
  input: ResolveWebhookAutomationTargetsInput,
): Promise<ReadonlyArray<ResolvedWebhookAutomationTarget>> {
  const candidateWebhookAutomations = await db.query.webhookAutomations.findMany({
    where: (table, { eq }) => eq(table.integrationConnectionId, input.integrationConnectionId),
  });

  if (candidateWebhookAutomations.length === 0) {
    return [];
  }

  const candidateAutomationIds = candidateWebhookAutomations.map(
    (automation) => automation.automationId,
  );
  const enabledAutomations = await db.query.automations.findMany({
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.kind, AutomationKinds.WEBHOOK),
        eq(table.enabled, true),
        inArray(table.id, candidateAutomationIds),
      ),
  });
  const enabledAutomationsById = new Set(enabledAutomations.map((automation) => automation.id));

  const eligibleWebhookAutomations: { automationId: string }[] = [];
  for (const candidateWebhookAutomation of candidateWebhookAutomations) {
    if (!enabledAutomationsById.has(candidateWebhookAutomation.automationId)) {
      continue;
    }

    const matched = isWebhookAutomationMatched({
      eventType: input.eventType,
      payload: input.payload,
      eventTypes: candidateWebhookAutomation.eventTypes ?? null,
      payloadFilter: candidateWebhookAutomation.payloadFilter ?? null,
    });
    if (!matched) {
      continue;
    }

    eligibleWebhookAutomations.push({
      automationId: candidateWebhookAutomation.automationId,
    });
  }

  if (eligibleWebhookAutomations.length === 0) {
    return [];
  }

  const eligibleAutomationIds = eligibleWebhookAutomations.map(
    (automation) => automation.automationId,
  );
  const targetRows = await db.query.automationTargets.findMany({
    where: (table, { inArray }) => inArray(table.automationId, eligibleAutomationIds),
  });
  const targetsByAutomationId = new Map<string, typeof targetRows>();
  for (const targetRow of targetRows) {
    const automationTargets = targetsByAutomationId.get(targetRow.automationId);
    if (automationTargets === undefined) {
      targetsByAutomationId.set(targetRow.automationId, [targetRow]);
      continue;
    }

    automationTargets.push(targetRow);
  }

  const resolvedTargets: ResolvedWebhookAutomationTarget[] = [];
  for (const eligibleWebhookAutomation of eligibleWebhookAutomations) {
    const automationTargets = targetsByAutomationId.get(eligibleWebhookAutomation.automationId);
    if (automationTargets === undefined) {
      continue;
    }

    for (const automationTarget of automationTargets) {
      resolvedTargets.push({
        automationId: eligibleWebhookAutomation.automationId,
        automationTargetId: automationTarget.id,
        sandboxProfileId: automationTarget.sandboxProfileId,
        sandboxProfileVersion: automationTarget.sandboxProfileVersion,
      });
    }
  }

  return resolvedTargets;
}
