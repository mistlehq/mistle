import {
  automations,
  automationTargets,
  type ControlPlaneTransaction,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import {
  assertSandboxProfileReferenceOrThrow,
  assertWebhookConnectionReferenceOrThrow,
  loadWebhookAutomationAggregateOrThrow,
} from "./shared.js";
import type {
  CreateAutomationWebhooksServiceInput,
  UpdateWebhookAutomationInput,
} from "./types.js";

export async function updateWebhookAutomation(
  input: CreateAutomationWebhooksServiceInput,
  serviceInput: UpdateWebhookAutomationInput,
) {
  const existingAutomation = await loadWebhookAutomationAggregateOrThrow(input.db, {
    organizationId: serviceInput.organizationId,
    automationId: serviceInput.automationId,
  });

  const integrationConnectionId =
    serviceInput.integrationConnectionId ?? existingAutomation.integrationConnectionId;
  const sandboxProfileId =
    serviceInput.target?.sandboxProfileId ?? existingAutomation.target.sandboxProfileId;

  await assertWebhookConnectionReferenceOrThrow(input.db, input.integrationRegistry, {
    organizationId: serviceInput.organizationId,
    integrationConnectionId,
  });
  await assertSandboxProfileReferenceOrThrow(input.db, {
    organizationId: serviceInput.organizationId,
    sandboxProfileId,
  });

  return input.db.transaction(async (tx) => {
    await updateAutomationBaseRow(tx, serviceInput);
    await updateWebhookConfigRow(tx, serviceInput);
    await updateAutomationTargetRow(tx, existingAutomation.target, serviceInput);

    return loadWebhookAutomationAggregateOrThrow(tx, {
      organizationId: serviceInput.organizationId,
      automationId: serviceInput.automationId,
    });
  });
}

async function updateAutomationBaseRow(
  tx: ControlPlaneTransaction,
  serviceInput: UpdateWebhookAutomationInput,
): Promise<void> {
  const nextValues: Partial<typeof automations.$inferInsert> = {};

  if (serviceInput.name !== undefined) {
    nextValues.name = serviceInput.name;
  }

  if (serviceInput.enabled !== undefined) {
    nextValues.enabled = serviceInput.enabled;
  }

  await tx
    .update(automations)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(automations.id, serviceInput.automationId));
}

async function updateWebhookConfigRow(
  tx: ControlPlaneTransaction,
  serviceInput: UpdateWebhookAutomationInput,
): Promise<void> {
  const nextValues: Partial<typeof webhookAutomations.$inferInsert> = {};

  if (serviceInput.integrationConnectionId !== undefined) {
    nextValues.integrationConnectionId = serviceInput.integrationConnectionId;
  }

  if (serviceInput.eventTypes !== undefined) {
    nextValues.eventTypes = serviceInput.eventTypes;
  }

  if (serviceInput.payloadFilter !== undefined) {
    nextValues.payloadFilter = serviceInput.payloadFilter;
  }

  if (serviceInput.inputTemplate !== undefined) {
    nextValues.inputTemplate = serviceInput.inputTemplate;
  }

  if (serviceInput.conversationKeyTemplate !== undefined) {
    nextValues.conversationKeyTemplate = serviceInput.conversationKeyTemplate;
  }

  if (serviceInput.idempotencyKeyTemplate !== undefined) {
    nextValues.idempotencyKeyTemplate = serviceInput.idempotencyKeyTemplate;
  }

  if (Object.keys(nextValues).length === 0) {
    return;
  }

  await tx
    .update(webhookAutomations)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(webhookAutomations.automationId, serviceInput.automationId));
}

async function updateAutomationTargetRow(
  tx: ControlPlaneTransaction,
  existingTarget: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number | null;
  },
  serviceInput: UpdateWebhookAutomationInput,
): Promise<void> {
  if (serviceInput.target === undefined) {
    return;
  }

  await tx
    .update(automationTargets)
    .set({
      sandboxProfileId: serviceInput.target.sandboxProfileId ?? existingTarget.sandboxProfileId,
      sandboxProfileVersion:
        serviceInput.target.sandboxProfileVersion === undefined
          ? existingTarget.sandboxProfileVersion
          : serviceInput.target.sandboxProfileVersion,
      updatedAt: sql`now()`,
    })
    .where(eq(automationTargets.id, existingTarget.id));
}
