import {
  TriggerKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

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

export type CreateWebhookTriggerInput = {
  organizationId: string;
  name: string;
  enabled?: boolean | undefined;
  integrationWebhookSourceId: string;
  eventTypes?: string[] | null | undefined;
  payloadFilter?: Record<string, unknown> | null | undefined;
  inputTemplate: string;
  instructions?: string | null | undefined;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate?: string | null | undefined;
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number | undefined;
    primaryRepositoryId?: string | null | undefined;
  };
};

type CreateWebhookTriggerPersistenceInput = Omit<CreateWebhookTriggerInput, "target"> & {
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
};

export async function createTriggerWebhook(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateWebhookTriggerInput,
) {
  const normalizedPayloadFilter = normalizeWebhookPayloadFilter(input.payloadFilter);
  assertEventScopedWebhookPayloadFilterOrThrow({
    eventTypes: input.eventTypes ?? null,
    payloadFilter: normalizedPayloadFilter ?? null,
  });

  const resolvedWebhookSource = await assertWebhookSourceReferenceOrThrow(
    { db: ctx.db, integrationRegistry: ctx.integrationRegistry },
    {
      organizationId: input.organizationId,
      integrationWebhookSourceId: input.integrationWebhookSourceId,
    },
  );
  assertWebhookTriggerRequirementsOrThrow({
    eventTypes: input.eventTypes ?? null,
    providerMetadata: resolvedWebhookSource.providerMetadata,
    supportedWebhookEvents: resolvedWebhookSource.supportedWebhookEvents,
  });
  await assertSandboxProfileReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId: input.target.sandboxProfileId,
    },
  );
  const sandboxProfileVersion = await resolveSandboxProfileTriggerReferenceOrThrow(
    { db: ctx.db },
    {
      sandboxProfileId: input.target.sandboxProfileId,
      sandboxProfileVersion: input.target.sandboxProfileVersion,
      integrationConnectionId: resolvedWebhookSource.integrationConnectionId,
    },
  );
  await assertPrimaryRepositoryReferenceOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      sandboxProfileId: input.target.sandboxProfileId,
      sandboxProfileVersion,
      primaryRepositoryId: input.target.primaryRepositoryId ?? null,
    },
  );

  return ctx.db.transaction(async (tx) => {
    const trigger = await createTriggerAggregate(tx, {
      ...input,
      payloadFilter: normalizedPayloadFilter,
      target: {
        sandboxProfileId: input.target.sandboxProfileId,
        sandboxProfileVersion,
        primaryRepositoryId: input.target.primaryRepositoryId ?? null,
      },
    });
    return loadWebhookTriggerAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        triggerId: trigger.id,
      },
    );
  });
}

async function createTriggerAggregate(
  tx: ControlPlaneTransaction,
  input: CreateWebhookTriggerPersistenceInput,
) {
  const tables = getControlPlaneDatabaseSchema(tx);

  const insertedTriggerRows = await tx
    .insert(tables.triggers)
    .values({
      organizationId: input.organizationId,
      kind: TriggerKinds.WEBHOOK,
      name: input.name,
      enabled: input.enabled ?? true,
    })
    .returning({
      id: tables.triggers.id,
    });

  const insertedTrigger = insertedTriggerRows[0];

  if (insertedTrigger === undefined) {
    throw new Error("Expected webhook trigger row to be inserted.");
  }

  await tx.insert(tables.webhookTriggers).values({
    triggerId: insertedTrigger.id,
    integrationWebhookSourceId: input.integrationWebhookSourceId,
    eventTypes: input.eventTypes ?? null,
    payloadFilter: input.payloadFilter ?? null,
    inputTemplate: input.inputTemplate,
    instructions: input.instructions ?? null,
    conversationKeyTemplate: input.conversationKeyTemplate,
    idempotencyKeyTemplate: input.idempotencyKeyTemplate ?? null,
  });

  await tx.insert(tables.triggerTargets).values({
    triggerId: insertedTrigger.id,
    sandboxProfileId: input.target.sandboxProfileId,
    sandboxProfileVersion: input.target.sandboxProfileVersion,
    primaryRepositoryId: input.target.primaryRepositoryId,
  });

  return insertedTrigger;
}
