import {
  automations,
  automationTargets,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  webhookAutomations,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";

import { assertSandboxProfileReferenceOrThrow } from "./assert-sandbox-profile-reference-or-throw.js";
import { assertSandboxProfileTriggerReferenceOrThrow } from "./assert-sandbox-profile-trigger-reference-or-throw.js";
import { assertWebhookConnectionReferenceOrThrow } from "./assert-webhook-connection-reference-or-throw.js";
import { loadWebhookAutomationAggregateOrThrow } from "./load-webhook-automation-aggregate-or-throw.js";

export type UpdateWebhookAutomationInput = {
  organizationId: string;
  automationId: string;
  name?: string | undefined;
  enabled?: boolean | undefined;
  integrationConnectionId?: string | undefined;
  eventTypes?: string[] | null | undefined;
  payloadFilter?: Record<string, unknown> | null | undefined;
  inputTemplate?: string | undefined;
  conversationKeyTemplate?: string | undefined;
  idempotencyKeyTemplate?: string | null | undefined;
  target?:
    | {
        sandboxProfileId?: string | undefined;
        sandboxProfileVersion?: number | null | undefined;
      }
    | undefined;
};

export async function updateAutomationWebhook(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: UpdateWebhookAutomationInput,
) {
  const existingAutomation = await loadWebhookAutomationAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      automationId: input.automationId,
    },
  );

  const integrationConnectionId =
    input.integrationConnectionId ?? existingAutomation.integrationConnectionId;
  const sandboxProfileId =
    input.target?.sandboxProfileId ?? existingAutomation.target.sandboxProfileId;
  const sandboxProfileVersion =
    input.target?.sandboxProfileVersion === undefined
      ? existingAutomation.target.sandboxProfileVersion
      : input.target.sandboxProfileVersion;

  await assertWebhookConnectionReferenceOrThrow(
    { db: ctx.db, integrationRegistry: ctx.integrationRegistry },
    {
      organizationId: input.organizationId,
      integrationConnectionId,
    },
  );
  await assertSandboxProfileReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId,
    },
  );
  await assertSandboxProfileTriggerReferenceOrThrow(
    { db: ctx.db },
    {
      sandboxProfileId,
      sandboxProfileVersion,
      integrationConnectionId,
    },
  );

  return ctx.db.transaction(async (tx) => {
    await updateAutomationBaseRow(tx, input);
    await updateWebhookConfigRow(tx, input);
    await updateAutomationTargetRow(tx, existingAutomation.target, input);

    return loadWebhookAutomationAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        automationId: input.automationId,
      },
    );
  });
}

async function updateAutomationBaseRow(
  tx: ControlPlaneTransaction,
  input: UpdateWebhookAutomationInput,
): Promise<void> {
  const nextValues: Partial<typeof automations.$inferInsert> = {};

  if (input.name !== undefined) {
    nextValues.name = input.name;
  }

  if (input.enabled !== undefined) {
    nextValues.enabled = input.enabled;
  }

  await tx
    .update(automations)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(automations.id, input.automationId));
}

async function updateWebhookConfigRow(
  tx: ControlPlaneTransaction,
  input: UpdateWebhookAutomationInput,
): Promise<void> {
  const nextValues: Partial<typeof webhookAutomations.$inferInsert> = {};

  if (input.integrationConnectionId !== undefined) {
    nextValues.integrationConnectionId = input.integrationConnectionId;
  }

  if (input.eventTypes !== undefined) {
    nextValues.eventTypes = input.eventTypes;
  }

  if (input.payloadFilter !== undefined) {
    nextValues.payloadFilter = input.payloadFilter;
  }

  if (input.inputTemplate !== undefined) {
    nextValues.inputTemplate = input.inputTemplate;
  }

  if (input.conversationKeyTemplate !== undefined) {
    nextValues.conversationKeyTemplate = input.conversationKeyTemplate;
  }

  if (input.idempotencyKeyTemplate !== undefined) {
    nextValues.idempotencyKeyTemplate = input.idempotencyKeyTemplate;
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
    .where(eq(webhookAutomations.automationId, input.automationId));
}

async function updateAutomationTargetRow(
  tx: ControlPlaneTransaction,
  existingTarget: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number | null;
  },
  input: UpdateWebhookAutomationInput,
): Promise<void> {
  if (input.target === undefined) {
    return;
  }

  await tx
    .update(automationTargets)
    .set({
      sandboxProfileId: input.target.sandboxProfileId ?? existingTarget.sandboxProfileId,
      sandboxProfileVersion:
        input.target.sandboxProfileVersion === undefined
          ? existingTarget.sandboxProfileVersion
          : input.target.sandboxProfileVersion,
      updatedAt: sql`now()`,
    })
    .where(eq(automationTargets.id, existingTarget.id));
}
