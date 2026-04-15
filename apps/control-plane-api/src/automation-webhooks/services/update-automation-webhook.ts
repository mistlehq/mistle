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
import { resolveSandboxProfileTriggerReferenceOrThrow } from "./assert-sandbox-profile-trigger-reference-or-throw.js";
import { assertWebhookSourceReferenceOrThrow } from "./assert-webhook-source-reference-or-throw.js";
import { loadWebhookAutomationAggregateOrThrow } from "./load-webhook-automation-aggregate-or-throw.js";
import {
  assertEventScopedWebhookPayloadFilterOrThrow,
  normalizeWebhookPayloadFilter,
} from "./webhook-payload-filter.js";

export type UpdateWebhookAutomationInput = {
  organizationId: string;
  automationId: string;
  name?: string | undefined;
  enabled?: boolean | undefined;
  integrationWebhookSourceId?: string | undefined;
  eventTypes?: string[] | null | undefined;
  payloadFilter?: Record<string, unknown> | null | undefined;
  inputTemplate?: string | undefined;
  instructions?: string | null | undefined;
  conversationKeyTemplate?: string | undefined;
  idempotencyKeyTemplate?: string | null | undefined;
  target?:
    | {
        sandboxProfileId?: string | undefined;
        sandboxProfileVersion?: number | undefined;
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

  const integrationWebhookSourceId =
    input.integrationWebhookSourceId ?? existingAutomation.integrationWebhookSourceId;
  const eventTypes = input.eventTypes ?? existingAutomation.eventTypes;
  const normalizedPayloadFilter = normalizeWebhookPayloadFilter(input.payloadFilter);
  const payloadFilter =
    normalizedPayloadFilter === undefined
      ? existingAutomation.payloadFilter
      : normalizedPayloadFilter;
  const sandboxProfileId =
    input.target?.sandboxProfileId ?? existingAutomation.target.sandboxProfileId;
  const sandboxProfileVersion =
    input.target?.sandboxProfileVersion === undefined
      ? existingAutomation.target.sandboxProfileVersion
      : input.target.sandboxProfileVersion;

  const resolvedWebhookSource = await assertWebhookSourceReferenceOrThrow(
    { db: ctx.db, integrationRegistry: ctx.integrationRegistry },
    {
      organizationId: input.organizationId,
      integrationWebhookSourceId,
    },
  );
  assertEventScopedWebhookPayloadFilterOrThrow({
    eventTypes,
    payloadFilter,
  });
  await assertSandboxProfileReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId,
    },
  );
  const resolvedSandboxProfileVersion = await resolveSandboxProfileTriggerReferenceOrThrow(
    { db: ctx.db },
    {
      sandboxProfileId,
      sandboxProfileVersion,
      integrationConnectionId: resolvedWebhookSource.integrationConnectionId,
    },
  );

  return ctx.db.transaction(async (tx) => {
    await updateAutomationBaseRow(tx, input);
    await updateWebhookConfigRow(tx, {
      ...input,
      payloadFilter: normalizedPayloadFilter,
    });
    await updateAutomationTargetRow(
      tx,
      existingAutomation.target.id,
      input.target === undefined
        ? undefined
        : {
            sandboxProfileId,
            sandboxProfileVersion: resolvedSandboxProfileVersion,
          },
    );

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

  if (input.integrationWebhookSourceId !== undefined) {
    nextValues.integrationWebhookSourceId = input.integrationWebhookSourceId;
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

  if (input.instructions !== undefined) {
    nextValues.instructions = input.instructions;
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
  automationTargetId: string,
  nextTarget:
    | {
        sandboxProfileId: string;
        sandboxProfileVersion: number;
      }
    | undefined,
): Promise<void> {
  if (nextTarget === undefined) {
    return;
  }

  await tx
    .update(automationTargets)
    .set({
      sandboxProfileId: nextTarget.sandboxProfileId,
      sandboxProfileVersion: nextTarget.sandboxProfileVersion,
      updatedAt: sql`now()`,
    })
    .where(eq(automationTargets.id, automationTargetId));
}
