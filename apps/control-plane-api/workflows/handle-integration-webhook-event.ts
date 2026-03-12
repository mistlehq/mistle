import { evaluateWebhookPayloadFilter, parseWebhookPayloadFilter } from "@mistle/automations";
import {
  automationRuns,
  AutomationKinds,
  AutomationRunStatuses,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";
import { defineWorkflow } from "openworkflow";

import { requestIntegrationConnectionResourceRefresh } from "../src/integration-connections/services/request-resource-refresh.js";
import { getWorkflowContext } from "./context.js";
import { HandleAutomationRunWorkflow } from "./handle-automation-run.js";

export type HandleIntegrationWebhookEventWorkflowInput = {
  webhookEventId: string;
};

export type HandleIntegrationWebhookEventWorkflowOutput = {
  webhookEventId: string;
};

type ResolveWebhookAutomationTargetsInput = {
  organizationId: string;
  integrationConnectionId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

type ResolvedWebhookAutomationTarget = {
  automationId: string;
  automationTargetId: string;
};

type EligibleWebhookAutomation = {
  automationId: string;
};

function isTerminalWebhookEventStatus(input: string): boolean {
  return (
    input === IntegrationWebhookEventStatuses.PROCESSED ||
    input === IntegrationWebhookEventStatuses.IGNORED ||
    input === IntegrationWebhookEventStatuses.DUPLICATE
  );
}

async function updateWebhookEventStatus(input: {
  db: ControlPlaneDatabase;
  webhookEventId: string;
  status: (typeof IntegrationWebhookEventStatuses)[keyof typeof IntegrationWebhookEventStatuses];
  finalized: boolean;
}): Promise<void> {
  await input.db
    .update(integrationWebhookEvents)
    .set({
      status: input.status,
      finalizedAt: input.finalized ? sql`now()` : null,
    })
    .where(eq(integrationWebhookEvents.id, input.webhookEventId));
}

async function resolveResourceSyncKindsForWebhookEvent(input: {
  db: ControlPlaneDatabase;
  targetKey: string;
  eventType: string;
  integrationRegistry: Awaited<ReturnType<typeof getWorkflowContext>>["integrationRegistry"];
}): Promise<ReadonlyArray<string>> {
  const target = await input.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, input.targetKey),
  });
  if (target === undefined) {
    throw new Error(`Integration target '${input.targetKey}' was not found.`);
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
    );
  }

  const matchedTrigger = definition.resourceSyncTriggers?.find(
    (trigger) => trigger.eventType === input.eventType,
  );

  return matchedTrigger?.resourceKinds ?? [];
}

function isWebhookAutomationMatched(input: {
  eventType: string;
  payload: Record<string, unknown>;
  eventTypes: ReadonlyArray<string> | null;
  payloadFilter: Record<string, unknown> | null;
}): boolean {
  const { eventType, payload, eventTypes, payloadFilter } = input;

  if (eventTypes !== null && !eventTypes.includes(eventType)) {
    return false;
  }

  if (payloadFilter === null) {
    return true;
  }

  const filter = parseWebhookPayloadFilter(payloadFilter);
  return evaluateWebhookPayloadFilter({
    filter,
    payload,
  });
}

async function resolveWebhookAutomationTargets(
  db: ControlPlaneDatabase,
  input: ResolveWebhookAutomationTargetsInput,
): Promise<ReadonlyArray<ResolvedWebhookAutomationTarget>> {
  const candidateWebhookAutomations = await db.query.webhookAutomations.findMany({
    where: (table, { eq }) => eq(table.integrationConnectionId, input.integrationConnectionId),
  });

  if (candidateWebhookAutomations.length === 0) {
    return [];
  }

  const candidateAutomationIds = candidateWebhookAutomations.map(
    (automation) => automation.automationId,
  );
  const enabledAutomations = await db.query.automations.findMany({
    where: (table, { and, eq: whereEq, inArray }) =>
      and(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.kind, AutomationKinds.WEBHOOK),
        whereEq(table.enabled, true),
        inArray(table.id, candidateAutomationIds),
      ),
  });
  const enabledAutomationIds = new Set(enabledAutomations.map((automation) => automation.id));

  const eligibleWebhookAutomations: EligibleWebhookAutomation[] = [];
  for (const candidateWebhookAutomation of candidateWebhookAutomations) {
    if (!enabledAutomationIds.has(candidateWebhookAutomation.automationId)) {
      continue;
    }

    if (
      !isWebhookAutomationMatched({
        eventType: input.eventType,
        payload: input.payload,
        eventTypes: candidateWebhookAutomation.eventTypes ?? null,
        payloadFilter: candidateWebhookAutomation.payloadFilter ?? null,
      })
    ) {
      continue;
    }

    eligibleWebhookAutomations.push({
      automationId: candidateWebhookAutomation.automationId,
    });
  }

  if (eligibleWebhookAutomations.length === 0) {
    return [];
  }

  const targetRows = await db.query.automationTargets.findMany({
    where: (table, { inArray }) =>
      inArray(
        table.automationId,
        eligibleWebhookAutomations.map((automation) => automation.automationId),
      ),
  });
  const targetsByAutomationId = new Map<string, typeof targetRows>();
  for (const targetRow of targetRows) {
    const automationTargets = targetsByAutomationId.get(targetRow.automationId);
    if (automationTargets === undefined) {
      targetsByAutomationId.set(targetRow.automationId, [targetRow]);
      continue;
    }

    automationTargets.push(targetRow);
  }

  const resolvedTargets: ResolvedWebhookAutomationTarget[] = [];
  for (const eligibleWebhookAutomation of eligibleWebhookAutomations) {
    const automationTargets = targetsByAutomationId.get(eligibleWebhookAutomation.automationId);
    if (automationTargets === undefined) {
      continue;
    }

    for (const automationTarget of automationTargets) {
      resolvedTargets.push({
        automationId: eligibleWebhookAutomation.automationId,
        automationTargetId: automationTarget.id,
      });
    }
  }

  return resolvedTargets;
}

export const HandleIntegrationWebhookEventWorkflow = defineWorkflow<
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput
>(
  {
    name: "control-plane.integration-webhooks.handle-event",
    version: "1",
  },
  async ({ input, step }) => {
    const ctx = await getWorkflowContext();

    return step.run(
      {
        name: "handle-webhook-event",
      },
      async () => {
        const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, input.webhookEventId),
        });
        if (webhookEvent === undefined) {
          throw new Error(`Webhook event '${input.webhookEventId}' was not found.`);
        }

        if (isTerminalWebhookEventStatus(webhookEvent.status)) {
          return {
            webhookEventId: input.webhookEventId,
          };
        }

        try {
          await updateWebhookEventStatus({
            db: ctx.db,
            webhookEventId: input.webhookEventId,
            status: IntegrationWebhookEventStatuses.PROCESSING,
            finalized: false,
          });

          const resourceSyncKinds = await resolveResourceSyncKindsForWebhookEvent({
            db: ctx.db,
            targetKey: webhookEvent.targetKey,
            eventType: webhookEvent.eventType,
            integrationRegistry: ctx.integrationRegistry,
          });
          for (const kind of resourceSyncKinds) {
            await requestIntegrationConnectionResourceRefresh(
              ctx.db,
              ctx.integrationRegistry,
              ctx.openWorkflow,
              {
                organizationId: webhookEvent.organizationId,
                connectionId: webhookEvent.integrationConnectionId,
                kind,
              },
            );
          }

          const resolvedTargets = await resolveWebhookAutomationTargets(ctx.db, {
            organizationId: webhookEvent.organizationId,
            integrationConnectionId: webhookEvent.integrationConnectionId,
            eventType: webhookEvent.eventType,
            payload: webhookEvent.payload,
          });

          if (resolvedTargets.length === 0 && resourceSyncKinds.length === 0) {
            await updateWebhookEventStatus({
              db: ctx.db,
              webhookEventId: input.webhookEventId,
              status: IntegrationWebhookEventStatuses.IGNORED,
              finalized: true,
            });

            return {
              webhookEventId: input.webhookEventId,
            };
          }

          if (resolvedTargets.length > 0) {
            await ctx.db
              .insert(automationRuns)
              .values(
                resolvedTargets.map((resolvedTarget) => ({
                  automationId: resolvedTarget.automationId,
                  automationTargetId: resolvedTarget.automationTargetId,
                  sourceWebhookEventId: input.webhookEventId,
                  status: AutomationRunStatuses.QUEUED,
                })),
              )
              .onConflictDoNothing({
                target: [automationRuns.automationTargetId, automationRuns.sourceWebhookEventId],
              });

            const queuedAutomationRuns = await ctx.db.query.automationRuns.findMany({
              columns: {
                id: true,
              },
              where: (table, { and, eq: whereEq, inArray }) =>
                and(
                  whereEq(table.sourceWebhookEventId, input.webhookEventId),
                  whereEq(table.status, AutomationRunStatuses.QUEUED),
                  inArray(
                    table.automationTargetId,
                    resolvedTargets.map((target) => target.automationTargetId),
                  ),
                ),
            });

            for (const queuedAutomationRun of queuedAutomationRuns) {
              await ctx.openWorkflow.runWorkflow(
                HandleAutomationRunWorkflow.spec,
                {
                  automationRunId: queuedAutomationRun.id,
                },
                {
                  idempotencyKey: queuedAutomationRun.id,
                },
              );
            }
          }

          await updateWebhookEventStatus({
            db: ctx.db,
            webhookEventId: input.webhookEventId,
            status: IntegrationWebhookEventStatuses.PROCESSED,
            finalized: true,
          });
        } catch (error) {
          await updateWebhookEventStatus({
            db: ctx.db,
            webhookEventId: input.webhookEventId,
            status: IntegrationWebhookEventStatuses.FAILED,
            finalized: true,
          });

          throw error;
        }

        return {
          webhookEventId: input.webhookEventId,
        };
      },
    );
  },
);
