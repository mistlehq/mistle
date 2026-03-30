import {
  AutomationKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

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
    sandboxProfileVersion: number;
  };
};

export async function loadWebhookAutomationAggregateOrThrow(
  ctx: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    automationId: string;
  },
): Promise<AutomationWebhookAggregate> {
  const automation = await ctx.db.query.automations.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.automationId),
        eq(table.organizationId, input.organizationId),
        eq(table.kind, AutomationKinds.WEBHOOK),
      ),
  });

  if (automation === undefined) {
    throw new NotFoundError("NOT_FOUND", "Webhook automation was not found.");
  }

  const [webhookAutomation, targets] = await Promise.all([
    ctx.db.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, automation.id),
    }),
    ctx.db.query.automationTargets.findMany({
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
