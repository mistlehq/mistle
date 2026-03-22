import {
  automations,
  AutomationKinds,
  automationTargets,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  webhookAutomations,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import {
  assertSandboxProfileReferenceOrThrow,
  assertWebhookConnectionReferenceOrThrow,
  loadWebhookAutomationAggregateOrThrow,
} from "../shared.js";
import type { CreateWebhookAutomationInput } from "../types.js";

export async function createAutomationWebhook(
  input: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  serviceInput: CreateWebhookAutomationInput,
) {
  await assertWebhookConnectionReferenceOrThrow(input.db, input.integrationRegistry, {
    organizationId: serviceInput.organizationId,
    integrationConnectionId: serviceInput.integrationConnectionId,
  });
  await assertSandboxProfileReferenceOrThrow(input.db, {
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.target.sandboxProfileId,
  });

  return input.db.transaction(async (tx) => {
    const automation = await createAutomationAggregate(tx, serviceInput);
    return loadWebhookAutomationAggregateOrThrow(tx, {
      organizationId: serviceInput.organizationId,
      automationId: automation.id,
    });
  });
}

async function createAutomationAggregate(
  tx: ControlPlaneTransaction,
  serviceInput: CreateWebhookAutomationInput,
) {
  const insertedAutomationRows = await tx
    .insert(automations)
    .values({
      organizationId: serviceInput.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: serviceInput.name,
      enabled: serviceInput.enabled ?? true,
    })
    .returning({
      id: automations.id,
    });

  const insertedAutomation = insertedAutomationRows[0];

  if (insertedAutomation === undefined) {
    throw new Error("Expected webhook automation row to be inserted.");
  }

  await tx.insert(webhookAutomations).values({
    automationId: insertedAutomation.id,
    integrationConnectionId: serviceInput.integrationConnectionId,
    eventTypes: serviceInput.eventTypes ?? null,
    payloadFilter: serviceInput.payloadFilter ?? null,
    inputTemplate: serviceInput.inputTemplate,
    conversationKeyTemplate: serviceInput.conversationKeyTemplate,
    idempotencyKeyTemplate: serviceInput.idempotencyKeyTemplate ?? null,
  });

  await tx.insert(automationTargets).values({
    automationId: insertedAutomation.id,
    sandboxProfileId: serviceInput.target.sandboxProfileId,
    sandboxProfileVersion: serviceInput.target.sandboxProfileVersion ?? null,
  });

  return insertedAutomation;
}
