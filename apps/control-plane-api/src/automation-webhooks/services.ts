import {
  AutomationKinds,
  IntegrationConnectionStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { AutomationWebhooksBadRequestCodes, AutomationWebhooksNotFoundCodes } from "./constants.js";

export type AutomationWebhookAggregate = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  integrationConnectionId: string;
  eventTypes: string[] | null;
  payloadFilter: Record<string, unknown> | null;
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  target: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number | null;
  };
};

export async function loadWebhookAutomationAggregateOrThrow(
  { db }: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    automationId: string;
  },
): Promise<AutomationWebhookAggregate> {
  const automation = await db.query.automations.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.automationId),
        eq(table.organizationId, input.organizationId),
        eq(table.kind, AutomationKinds.WEBHOOK),
      ),
  });

  if (automation === undefined) {
    throw new NotFoundError(
      AutomationWebhooksNotFoundCodes.AUTOMATION_NOT_FOUND,
      "Webhook automation was not found.",
    );
  }

  const [webhookAutomation, targets] = await Promise.all([
    db.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, automation.id),
    }),
    db.query.automationTargets.findMany({
      where: (table, { eq }) => eq(table.automationId, automation.id),
    }),
  ]);

  if (webhookAutomation === undefined) {
    throw new Error(
      `Webhook automation '${automation.id}' is missing its webhook configuration row.`,
    );
  }

  if (targets.length !== 1 || targets[0] === undefined) {
    throw new Error(
      `Webhook automation '${automation.id}' must have exactly one automation target.`,
    );
  }

  const target = targets[0];

  return {
    id: automation.id,
    name: automation.name,
    enabled: automation.enabled,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
    integrationConnectionId: webhookAutomation.integrationConnectionId,
    eventTypes: webhookAutomation.eventTypes,
    payloadFilter: webhookAutomation.payloadFilter,
    inputTemplate: webhookAutomation.inputTemplate,
    conversationKeyTemplate: webhookAutomation.conversationKeyTemplate,
    idempotencyKeyTemplate: webhookAutomation.idempotencyKeyTemplate,
    target: {
      id: target.id,
      sandboxProfileId: target.sandboxProfileId,
      sandboxProfileVersion: target.sandboxProfileVersion,
    },
  };
}

export async function assertWebhookConnectionReferenceOrThrow(
  {
    db,
    integrationRegistry,
  }: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    integrationConnectionId: string;
  },
): Promise<void> {
  const connection = await db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.integrationConnectionId),
        eq(table.organizationId, input.organizationId),
        eq(table.status, IntegrationConnectionStatuses.ACTIVE),
      ),
  });

  if (connection === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.INVALID_CONNECTION_REFERENCE,
      "Integration connection must reference an active connection in the active organization.",
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(`Integration target '${connection.targetKey}' was not found.`);
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  if (definition.webhookHandler === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE,
      "Integration connection target does not define webhook handling.",
    );
  }
}

export async function assertSandboxProfileReferenceOrThrow(
  { db }: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    sandboxProfileId: string;
  },
): Promise<void> {
  const profile = await db.query.sandboxProfiles.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sandboxProfileId), eq(table.organizationId, input.organizationId)),
  });

  if (profile === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
      "Sandbox profile must reference a profile in the active organization.",
    );
  }
}
