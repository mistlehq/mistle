import {
  automationRuns,
  AutomationRunStatuses,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type {
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
} from "@mistle/workflows/control-plane";
import { eq, sql } from "drizzle-orm";

import { resolveWebhookAutomationTargets } from "./resolve-webhook-automation-targets.js";

type HandleIntegrationWebhookEventDependencies = {
  db: ControlPlaneDatabase;
  enqueueAutomationRuns: (input: { automationRunIds: ReadonlyArray<string> }) => Promise<void>;
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

export async function handleIntegrationWebhookEvent(
  deps: HandleIntegrationWebhookEventDependencies,
  input: HandleIntegrationWebhookEventWorkflowInput,
): Promise<HandleIntegrationWebhookEventWorkflowOutput> {
  const webhookEvent = await deps.db.query.integrationWebhookEvents.findFirst({
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
      db: deps.db,
      webhookEventId: input.webhookEventId,
      status: IntegrationWebhookEventStatuses.PROCESSING,
      finalized: false,
    });

    const resolvedTargets = await resolveWebhookAutomationTargets(deps.db, {
      organizationId: webhookEvent.organizationId,
      integrationConnectionId: webhookEvent.integrationConnectionId,
      eventType: webhookEvent.eventType,
      payload: webhookEvent.payload,
    });
    if (resolvedTargets.length === 0) {
      await updateWebhookEventStatus({
        db: deps.db,
        webhookEventId: input.webhookEventId,
        status: IntegrationWebhookEventStatuses.IGNORED,
        finalized: true,
      });

      return {
        webhookEventId: input.webhookEventId,
      };
    }

    await deps.db
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

    const queuedAutomationRuns = await deps.db.query.automationRuns.findMany({
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

    const queuedAutomationRunIds = queuedAutomationRuns.map((queuedRun) => queuedRun.id);
    if (queuedAutomationRunIds.length > 0) {
      await deps.enqueueAutomationRuns({
        automationRunIds: queuedAutomationRunIds,
      });
    }

    await updateWebhookEventStatus({
      db: deps.db,
      webhookEventId: input.webhookEventId,
      status: IntegrationWebhookEventStatuses.PROCESSED,
      finalized: true,
    });
  } catch (error) {
    await updateWebhookEventStatus({
      db: deps.db,
      webhookEventId: input.webhookEventId,
      status: IntegrationWebhookEventStatuses.FAILED,
      finalized: true,
    });

    throw error;
  }

  return {
    webhookEventId: input.webhookEventId,
  };
}
