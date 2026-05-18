import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";

import { assertPrimaryRepositoryReferenceOrThrow } from "./assert-primary-repository-reference-or-throw.js";
import { assertSandboxProfileReferenceOrThrow } from "./assert-sandbox-profile-reference-or-throw.js";
import { resolveSandboxProfileTriggerReferenceOrThrow } from "./assert-sandbox-profile-trigger-reference-or-throw.js";
import { assertWebhookSourceReferenceOrThrow } from "./assert-webhook-source-reference-or-throw.js";
import { assertWebhookTriggerRequirementsOrThrow } from "./assert-webhook-trigger-requirements-or-throw.js";
import { loadWebhookTriggerAggregateOrThrow } from "./load-webhook-trigger-aggregate-or-throw.js";
import {
  assertEventScopedWebhookPayloadFilterOrThrow,
  normalizeWebhookPayloadFilter,
} from "./webhook-payload-filter.js";

export type UpdateWebhookTriggerInput = {
  organizationId: string;
  triggerId: string;
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
        primaryRepositoryId?: string | null | undefined;
      }
    | undefined;
};

export async function updateTriggerWebhook(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: UpdateWebhookTriggerInput,
) {
  const existingTrigger = await loadWebhookTriggerAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      triggerId: input.triggerId,
    },
  );

  const integrationWebhookSourceId =
    input.integrationWebhookSourceId ?? existingTrigger.integrationWebhookSourceId;
  const eventTypes = input.eventTypes === undefined ? existingTrigger.eventTypes : input.eventTypes;
  const normalizedPayloadFilter = normalizeWebhookPayloadFilter(input.payloadFilter);
  const payloadFilter =
    normalizedPayloadFilter === undefined ? existingTrigger.payloadFilter : normalizedPayloadFilter;
  const sandboxProfileId =
    input.target?.sandboxProfileId ?? existingTrigger.target.sandboxProfileId;
  const sandboxProfileVersion =
    input.target?.sandboxProfileVersion === undefined
      ? existingTrigger.target.sandboxProfileVersion
      : input.target.sandboxProfileVersion;
  const primaryRepositoryId =
    input.target?.primaryRepositoryId === undefined
      ? existingTrigger.target.primaryRepositoryId
      : input.target.primaryRepositoryId;

  const resolvedWebhookSource = await assertWebhookSourceReferenceOrThrow(
    { db: ctx.db, integrationRegistry: ctx.integrationRegistry },
    {
      organizationId: input.organizationId,
      integrationWebhookSourceId,
    },
  );
  assertWebhookTriggerRequirementsOrThrow({
    eventTypes,
    providerMetadata: resolvedWebhookSource.providerMetadata,
    supportedWebhookEvents: resolvedWebhookSource.supportedWebhookEvents,
  });
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
  await assertPrimaryRepositoryReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId,
      sandboxProfileVersion: resolvedSandboxProfileVersion,
      primaryRepositoryId,
    },
  );

  return ctx.db.transaction(async (tx) => {
    await updateTriggerBaseRow(tx, input);
    await updateWebhookConfigRow(tx, {
      ...input,
      payloadFilter: normalizedPayloadFilter,
    });
    await updateTriggerTargetRow(
      tx,
      existingTrigger.target.id,
      input.target === undefined
        ? undefined
        : {
            sandboxProfileId,
            sandboxProfileVersion: resolvedSandboxProfileVersion,
            primaryRepositoryId,
          },
    );

    return loadWebhookTriggerAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        triggerId: input.triggerId,
      },
    );
  });
}

async function updateTriggerBaseRow(
  tx: ControlPlaneTransaction,
  input: UpdateWebhookTriggerInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);

  const nextValues: Partial<typeof tables.triggers.$inferInsert> = {};

  if (input.name !== undefined) {
    nextValues.name = input.name;
  }

  if (input.enabled !== undefined) {
    nextValues.enabled = input.enabled;
  }

  await tx
    .update(tables.triggers)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.triggers.id, input.triggerId));
}

async function updateWebhookConfigRow(
  tx: ControlPlaneTransaction,
  input: UpdateWebhookTriggerInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);

  const nextValues: Partial<typeof tables.webhookTriggers.$inferInsert> = {};

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
    .update(tables.webhookTriggers)
    .set({
      ...nextValues,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.webhookTriggers.triggerId, input.triggerId));
}

async function updateTriggerTargetRow(
  tx: ControlPlaneTransaction,
  triggerTargetId: string,
  nextTarget:
    | {
        sandboxProfileId: string;
        sandboxProfileVersion: number;
        primaryRepositoryId: string | null;
      }
    | undefined,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(tx);

  if (nextTarget === undefined) {
    return;
  }

  await tx
    .update(tables.triggerTargets)
    .set({
      sandboxProfileId: nextTarget.sandboxProfileId,
      sandboxProfileVersion: nextTarget.sandboxProfileVersion,
      primaryRepositoryId: nextTarget.primaryRepositoryId,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.triggerTargets.id, triggerTargetId));
}
