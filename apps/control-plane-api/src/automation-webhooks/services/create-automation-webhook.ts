import {
  AutomationKinds,
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
import { loadWebhookAutomationAggregateOrThrow } from "./load-webhook-automation-aggregate-or-throw.js";
import {
  assertEventScopedWebhookPayloadFilterOrThrow,
  normalizeWebhookPayloadFilter,
} from "./webhook-payload-filter.js";

export type CreateWebhookAutomationInput = {
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

type CreateWebhookAutomationPersistenceInput = Omit<CreateWebhookAutomationInput, "target"> & {
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
};

export async function createAutomationWebhook(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateWebhookAutomationInput,
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
    const automation = await createAutomationAggregate(tx, {
      ...input,
      payloadFilter: normalizedPayloadFilter,
      target: {
        sandboxProfileId: input.target.sandboxProfileId,
        sandboxProfileVersion,
        primaryRepositoryId: input.target.primaryRepositoryId ?? null,
      },
    });
    return loadWebhookAutomationAggregateOrThrow(
      { db: tx },
      {
        organizationId: input.organizationId,
        automationId: automation.id,
      },
    );
  });
}

async function createAutomationAggregate(
  tx: ControlPlaneTransaction,
  input: CreateWebhookAutomationPersistenceInput,
) {
  const tables = getControlPlaneDatabaseSchema(tx);

  const insertedAutomationRows = await tx
    .insert(tables.automations)
    .values({
      organizationId: input.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: input.name,
      enabled: input.enabled ?? true,
    })
    .returning({
      id: tables.automations.id,
    });

  const insertedAutomation = insertedAutomationRows[0];

  if (insertedAutomation === undefined) {
    throw new Error("Expected webhook automation row to be inserted.");
  }

  await tx.insert(tables.webhookAutomations).values({
    automationId: insertedAutomation.id,
    integrationWebhookSourceId: input.integrationWebhookSourceId,
    eventTypes: input.eventTypes ?? null,
    payloadFilter: input.payloadFilter ?? null,
    inputTemplate: input.inputTemplate,
    instructions: input.instructions ?? null,
    conversationKeyTemplate: input.conversationKeyTemplate,
    idempotencyKeyTemplate: input.idempotencyKeyTemplate ?? null,
  });

  await tx.insert(tables.automationTargets).values({
    automationId: insertedAutomation.id,
    sandboxProfileId: input.target.sandboxProfileId,
    sandboxProfileVersion: input.target.sandboxProfileVersion,
    primaryRepositoryId: input.target.primaryRepositoryId,
  });

  return insertedAutomation;
}
