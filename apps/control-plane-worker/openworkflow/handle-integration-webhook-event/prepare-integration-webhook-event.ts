import {
  automationRuns,
  AutomationRunStatuses,
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import type { HandleIntegrationWebhookEventWorkflowInput } from "@mistle/workflow-registry/control-plane";

import { resolveResourceSyncKindsForWebhookEvent } from "./resolve-resource-sync-kinds-for-webhook-event.js";
import { resolveWebhookAutomationTargets } from "./resolve-webhook-automation-targets.js";
import { updateWebhookEventStatus } from "./update-webhook-event-status.js";

export type IntegrationWebhookResourceSyncRequest = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type PrepareIntegrationWebhookEventOutput = {
  webhookEventId: string;
  automationRunIds: ReadonlyArray<string>;
  resourceSyncRequests: ReadonlyArray<IntegrationWebhookResourceSyncRequest>;
  finalized: boolean;
};

function isTerminalWebhookEventStatus(input: string): boolean {
  return (
    input === IntegrationWebhookEventStatuses.PROCESSED ||
    input === IntegrationWebhookEventStatuses.IGNORED ||
    input === IntegrationWebhookEventStatuses.DUPLICATE
  );
}

export async function prepareIntegrationWebhookEvent(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: HandleIntegrationWebhookEventWorkflowInput,
): Promise<PrepareIntegrationWebhookEventOutput> {
  const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.webhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new Error(`Webhook event '${input.webhookEventId}' was not found.`);
  }

  if (isTerminalWebhookEventStatus(webhookEvent.status)) {
    return {
      automationRunIds: [],
      finalized: true,
      resourceSyncRequests: [],
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
      integrationRegistry: ctx.integrationRegistry,
      targetKey: webhookEvent.targetKey,
      eventType: webhookEvent.eventType,
    });
    const resourceSyncRequests = resourceSyncKinds.map((kind) => ({
      organizationId: webhookEvent.organizationId,
      connectionId: webhookEvent.integrationConnectionId,
      kind,
    }));

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
        automationRunIds: [],
        finalized: true,
        resourceSyncRequests: [],
        webhookEventId: input.webhookEventId,
      };
    }

    let queuedAutomationRunIds: ReadonlyArray<string> = [];
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
        where: (table, { and: whereAnd, eq: whereEq, inArray: whereInArray }) =>
          whereAnd(
            whereEq(table.sourceWebhookEventId, input.webhookEventId),
            whereEq(table.status, AutomationRunStatuses.QUEUED),
            whereInArray(
              table.automationTargetId,
              resolvedTargets.map((target) => target.automationTargetId),
            ),
          ),
      });

      queuedAutomationRunIds = queuedAutomationRuns.map((queuedRun) => queuedRun.id);
    }

    return {
      automationRunIds: queuedAutomationRunIds,
      finalized: false,
      resourceSyncRequests,
      webhookEventId: input.webhookEventId,
    };
  } catch (error) {
    await updateWebhookEventStatus({
      db: ctx.db,
      webhookEventId: input.webhookEventId,
      status: IntegrationWebhookEventStatuses.FAILED,
      finalized: true,
    });

    throw error;
  }
}
