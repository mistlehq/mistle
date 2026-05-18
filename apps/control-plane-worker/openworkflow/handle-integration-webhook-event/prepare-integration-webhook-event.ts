import {
  TriggerRunStatuses,
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import type { HandleIntegrationWebhookEventWorkflowInput } from "@mistle/workflow-registry/control-plane";

import { resolveResourceSyncKindsForWebhookEvent } from "./resolve-resource-sync-kinds-for-webhook-event.js";
import { resolveWebhookTriggerTargets } from "./resolve-webhook-trigger-targets.js";
import { updateWebhookEventStatus } from "./update-webhook-event-status.js";

export type IntegrationWebhookResourceSyncRequest = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type PrepareIntegrationWebhookEventOutput = {
  webhookEventId: string;
  externalDeliveryId: string | null;
  integrationConnectionId: string;
  targetKey: string;
  webhookEventStatus: (typeof IntegrationWebhookEventStatuses)[keyof typeof IntegrationWebhookEventStatuses];
  triggerRunIds: ReadonlyArray<string>;
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
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.webhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new Error(`Webhook event '${input.webhookEventId}' was not found.`);
  }

  if (isTerminalWebhookEventStatus(webhookEvent.status)) {
    return {
      triggerRunIds: [],
      externalDeliveryId: webhookEvent.externalDeliveryId,
      finalized: true,
      integrationConnectionId: webhookEvent.integrationConnectionId,
      resourceSyncRequests: [],
      targetKey: webhookEvent.targetKey,
      webhookEventStatus: webhookEvent.status,
      webhookEventId: input.webhookEventId,
    };
  }

  try {
    const transitionedToProcessing = await updateWebhookEventStatus({
      db: ctx.db,
      webhookEventId: input.webhookEventId,
      status: IntegrationWebhookEventStatuses.PROCESSING,
      finalized: false,
      fromStatuses: [
        IntegrationWebhookEventStatuses.RECEIVED,
        IntegrationWebhookEventStatuses.FAILED,
      ],
    });
    if (!transitionedToProcessing) {
      const currentWebhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
        columns: {
          status: true,
        },
        where: (table, { eq: whereEq }) => whereEq(table.id, input.webhookEventId),
      });
      if (currentWebhookEvent === undefined) {
        throw new Error(`Webhook event '${input.webhookEventId}' was not found.`);
      }

      if (
        currentWebhookEvent.status === IntegrationWebhookEventStatuses.PROCESSING ||
        isTerminalWebhookEventStatus(currentWebhookEvent.status)
      ) {
        return {
          triggerRunIds: [],
          externalDeliveryId: webhookEvent.externalDeliveryId,
          finalized: true,
          integrationConnectionId: webhookEvent.integrationConnectionId,
          resourceSyncRequests: [],
          targetKey: webhookEvent.targetKey,
          webhookEventStatus: currentWebhookEvent.status,
          webhookEventId: input.webhookEventId,
        };
      }

      throw new Error(
        `Failed to transition webhook event '${input.webhookEventId}' into processing from status '${currentWebhookEvent.status}'.`,
      );
    }

    if (webhookEvent.integrationWebhookSourceId == null) {
      throw new Error(`Webhook event '${webhookEvent.id}' is missing integrationWebhookSourceId.`);
    }

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

    const resolvedTargets = await resolveWebhookTriggerTargets(ctx.db, {
      organizationId: webhookEvent.organizationId,
      integrationWebhookSourceId: webhookEvent.integrationWebhookSourceId,
      eventType: webhookEvent.eventType,
      payload: webhookEvent.payload,
    });
    if (resolvedTargets.length === 0 && resourceSyncKinds.length === 0) {
      await updateWebhookEventStatus({
        db: ctx.db,
        webhookEventId: input.webhookEventId,
        status: IntegrationWebhookEventStatuses.IGNORED,
        finalized: true,
        fromStatuses: [IntegrationWebhookEventStatuses.PROCESSING],
      });

      return {
        triggerRunIds: [],
        externalDeliveryId: webhookEvent.externalDeliveryId,
        finalized: true,
        integrationConnectionId: webhookEvent.integrationConnectionId,
        resourceSyncRequests: [],
        targetKey: webhookEvent.targetKey,
        webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
        webhookEventId: input.webhookEventId,
      };
    }

    let queuedTriggerRunIds: ReadonlyArray<string> = [];
    if (resolvedTargets.length > 0) {
      await ctx.db
        .insert(tables.triggerRuns)
        .values(
          resolvedTargets.map((resolvedTarget) => ({
            triggerId: resolvedTarget.triggerId,
            triggerTargetId: resolvedTarget.triggerTargetId,
            sourceWebhookEventId: input.webhookEventId,
            status: TriggerRunStatuses.QUEUED,
          })),
        )
        .onConflictDoNothing({
          target: [tables.triggerRuns.triggerTargetId, tables.triggerRuns.sourceWebhookEventId],
        });

      const queuedTriggerRuns = await ctx.db.query.triggerRuns.findMany({
        columns: {
          id: true,
        },
        where: (table, { and: whereAnd, eq: whereEq, inArray: whereInArray }) =>
          whereAnd(
            whereEq(table.sourceWebhookEventId, input.webhookEventId),
            whereEq(table.status, TriggerRunStatuses.QUEUED),
            whereInArray(
              table.triggerTargetId,
              resolvedTargets.map((target) => target.triggerTargetId),
            ),
          ),
      });

      queuedTriggerRunIds = queuedTriggerRuns.map((queuedRun) => queuedRun.id);
    }

    return {
      triggerRunIds: queuedTriggerRunIds,
      externalDeliveryId: webhookEvent.externalDeliveryId,
      finalized: false,
      integrationConnectionId: webhookEvent.integrationConnectionId,
      resourceSyncRequests,
      targetKey: webhookEvent.targetKey,
      webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
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
