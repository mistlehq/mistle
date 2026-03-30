import {
  automations,
  AutomationKinds,
  automationTargets,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  webhookAutomations,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { assertSandboxProfileReferenceOrThrow } from "./assert-sandbox-profile-reference-or-throw.js";
import { resolveSandboxProfileTriggerReferenceOrThrow } from "./assert-sandbox-profile-trigger-reference-or-throw.js";
import { assertWebhookConnectionReferenceOrThrow } from "./assert-webhook-connection-reference-or-throw.js";
import { loadWebhookAutomationAggregateOrThrow } from "./load-webhook-automation-aggregate-or-throw.js";

export type CreateWebhookAutomationInput = {
  organizationId: string;
  name: string;
  enabled?: boolean | undefined;
  integrationConnectionId: string;
  eventTypes?: string[] | null | undefined;
  payloadFilter?: Record<string, unknown> | null | undefined;
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate?: string | null | undefined;
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number | undefined;
  };
};

type CreateWebhookAutomationPersistenceInput = Omit<CreateWebhookAutomationInput, "target"> & {
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  };
};

export async function createAutomationWebhook(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateWebhookAutomationInput,
) {
  await assertWebhookConnectionReferenceOrThrow(
    { db: ctx.db, integrationRegistry: ctx.integrationRegistry },
    {
      organizationId: input.organizationId,
      integrationConnectionId: input.integrationConnectionId,
    },
  );
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
      integrationConnectionId: input.integrationConnectionId,
    },
  );

  return ctx.db.transaction(async (tx) => {
    const automation = await createAutomationAggregate(tx, {
      ...input,
      target: {
        sandboxProfileId: input.target.sandboxProfileId,
        sandboxProfileVersion,
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
  const insertedAutomationRows = await tx
    .insert(automations)
    .values({
      organizationId: input.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: input.name,
      enabled: input.enabled ?? true,
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
    integrationConnectionId: input.integrationConnectionId,
    eventTypes: input.eventTypes ?? null,
    payloadFilter: input.payloadFilter ?? null,
    inputTemplate: input.inputTemplate,
    conversationKeyTemplate: input.conversationKeyTemplate,
    idempotencyKeyTemplate: input.idempotencyKeyTemplate ?? null,
  });

  await tx.insert(automationTargets).values({
    automationId: insertedAutomation.id,
    sandboxProfileId: input.target.sandboxProfileId,
    sandboxProfileVersion: input.target.sandboxProfileVersion,
  });

  return insertedAutomation;
}
