import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  TriggerRunStatuses,
  IntegrationWebhookEventStatuses,
  TriggerConversationOwnerKinds,
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  type ControlPlaneDatabase,
  type IntegrationWebhookEvent,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import type { HandleIntegrationWebhookEventWorkflowInput } from "@mistle/workflow-registry/control-plane";
import { and, eq, inArray, sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import { renderTemplateString } from "../shared/render-template-string.js";
import { logWebhookDeliveryEvent } from "../shared/webhook-delivery-telemetry.js";
import {
  prepareProviderResourceAssociationDeliveries,
  type QueuedProviderResourceAssociationDelivery,
} from "./prepare-provider-resource-association-deliveries.js";
import { resolveResourceSyncKindsForWebhookEvent } from "./resolve-resource-sync-kinds-for-webhook-event.js";
import {
  resolveWebhookTriggerTargets,
  type ResolvedWebhookTriggerTarget,
} from "./resolve-webhook-trigger-targets.js";
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
  providerResourceAssociationDeliveries: ReadonlyArray<QueuedProviderResourceAssociationDelivery>;
  resourceSyncRequests: ReadonlyArray<IntegrationWebhookResourceSyncRequest>;
  finalized: boolean;
};

type ResolvedWebhookTriggerTargetRun = {
  triggerRunId: string;
  target: ResolvedWebhookTriggerTarget;
};

type ResolvedQueueableTriggerTargetRuns = {
  queueableTargetRuns: ReadonlyArray<ResolvedWebhookTriggerTargetRun>;
  suppressedTargets: ReadonlyArray<ResolvedWebhookTriggerTarget>;
};

type PrepareWebhookEventWorkInput = {
  integrationWebhookSourceId: string;
  resourceSyncKinds: ReadonlyArray<string>;
  resourceSyncRequests: ReadonlyArray<IntegrationWebhookResourceSyncRequest>;
  webhookEvent: IntegrationWebhookEvent;
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
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "getSandboxInstance">;
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
      triggerRunIds: [],
      externalDeliveryId: webhookEvent.externalDeliveryId,
      finalized: true,
      integrationConnectionId: webhookEvent.integrationConnectionId,
      providerResourceAssociationDeliveries: [],
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

      if (isTerminalWebhookEventStatus(currentWebhookEvent.status)) {
        return {
          triggerRunIds: [],
          externalDeliveryId: webhookEvent.externalDeliveryId,
          finalized: true,
          integrationConnectionId: webhookEvent.integrationConnectionId,
          providerResourceAssociationDeliveries: [],
          resourceSyncRequests: [],
          targetKey: webhookEvent.targetKey,
          webhookEventStatus: currentWebhookEvent.status,
          webhookEventId: input.webhookEventId,
        };
      }
      if (currentWebhookEvent.status === IntegrationWebhookEventStatuses.PROCESSING) {
        const resourceSyncKinds = await resolveResourceSyncKindsForWebhookEvent({
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          targetKey: webhookEvent.targetKey,
          eventType: webhookEvent.eventType,
        });
        const resourceSyncRequests = await resolveRecoverableResourceSyncRequests(ctx.db, {
          webhookEvent,
          resourceSyncKinds,
        });

        if (webhookEvent.integrationWebhookSourceId == null) {
          throw new Error(
            `Webhook event '${webhookEvent.id}' is missing integrationWebhookSourceId.`,
          );
        }

        return prepareWebhookEventWork(ctx, {
          integrationWebhookSourceId: webhookEvent.integrationWebhookSourceId,
          resourceSyncKinds,
          resourceSyncRequests,
          webhookEvent,
        });
      } else {
        throw new Error(
          `Failed to transition webhook event '${input.webhookEventId}' into processing from status '${currentWebhookEvent.status}'.`,
        );
      }
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

    return prepareWebhookEventWork(ctx, {
      integrationWebhookSourceId: webhookEvent.integrationWebhookSourceId,
      resourceSyncKinds,
      resourceSyncRequests,
      webhookEvent,
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
}

async function prepareWebhookEventWork(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: PrepareWebhookEventWorkInput,
): Promise<PrepareIntegrationWebhookEventOutput> {
  const resolvedTargets = await resolveWebhookTriggerTargets(ctx.db, {
    organizationId: input.webhookEvent.organizationId,
    integrationWebhookSourceId: input.integrationWebhookSourceId,
    eventType: input.webhookEvent.eventType,
    payload: input.webhookEvent.payload,
  });
  const providerResourceAssociationDeliveries = await prepareProviderResourceAssociationDeliveries(
    {
      controlPlaneInternalClient: ctx.controlPlaneInternalClient,
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
    },
    {
      webhookEvent: input.webhookEvent,
    },
  );
  const triggerTargetRuns = await resolveQueueableTriggerTargetRuns(ctx.db, {
    providerResourceAssociationDeliveries,
    resolvedTargets,
    webhookEvent: input.webhookEvent,
  });
  await markExistingSuppressedTriggerRunsIgnored(ctx.db, {
    sourceWebhookEventId: input.webhookEvent.id,
    suppressedTargets: triggerTargetRuns.suppressedTargets,
  });

  if (
    triggerTargetRuns.queueableTargetRuns.length === 0 &&
    input.resourceSyncKinds.length === 0 &&
    providerResourceAssociationDeliveries.length === 0
  ) {
    await updateWebhookEventStatus({
      db: ctx.db,
      webhookEventId: input.webhookEvent.id,
      status: IntegrationWebhookEventStatuses.IGNORED,
      finalized: true,
      fromStatuses: [IntegrationWebhookEventStatuses.PROCESSING],
    });

    return {
      triggerRunIds: [],
      externalDeliveryId: input.webhookEvent.externalDeliveryId,
      finalized: true,
      integrationConnectionId: input.webhookEvent.integrationConnectionId,
      providerResourceAssociationDeliveries: [],
      resourceSyncRequests: [],
      targetKey: input.webhookEvent.targetKey,
      webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
      webhookEventId: input.webhookEvent.id,
    };
  }

  const queuedTriggerRunIds = await insertQueuedTriggerRuns(ctx.db, {
    sourceWebhookEventId: input.webhookEvent.id,
    targetRuns: triggerTargetRuns.queueableTargetRuns,
  });

  return {
    triggerRunIds: queuedTriggerRunIds,
    externalDeliveryId: input.webhookEvent.externalDeliveryId,
    finalized: false,
    integrationConnectionId: input.webhookEvent.integrationConnectionId,
    providerResourceAssociationDeliveries,
    resourceSyncRequests: input.resourceSyncRequests,
    targetKey: input.webhookEvent.targetKey,
    webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
    webhookEventId: input.webhookEvent.id,
  };
}

async function resolveQueueableTriggerTargetRuns(
  db: ControlPlaneDatabase,
  input: {
    providerResourceAssociationDeliveries: ReadonlyArray<QueuedProviderResourceAssociationDelivery>;
    resolvedTargets: ReadonlyArray<ResolvedWebhookTriggerTarget>;
    webhookEvent: IntegrationWebhookEvent;
  },
): Promise<ResolvedQueueableTriggerTargetRuns> {
  if (input.resolvedTargets.length === 0) {
    return {
      queueableTargetRuns: [],
      suppressedTargets: [],
    };
  }

  const associationDeliveriesBySandboxInstanceId = new Map<
    string,
    QueuedProviderResourceAssociationDelivery
  >();
  for (const delivery of input.providerResourceAssociationDeliveries) {
    if (!associationDeliveriesBySandboxInstanceId.has(delivery.sandboxInstanceId)) {
      associationDeliveriesBySandboxInstanceId.set(delivery.sandboxInstanceId, delivery);
    }
  }
  if (associationDeliveriesBySandboxInstanceId.size === 0) {
    return {
      queueableTargetRuns: input.resolvedTargets.map((target) => ({
        triggerRunId: typeid("trn").toString(),
        target,
      })),
      suppressedTargets: [],
    };
  }

  const queueableTargets: ResolvedWebhookTriggerTargetRun[] = [];
  const suppressedTargets: ResolvedWebhookTriggerTarget[] = [];
  for (const target of input.resolvedTargets) {
    const triggerRunId = typeid("trn").toString();
    const renderedConversationKeyResult = renderTriggerConversationKey({
      target,
      triggerRunId,
      webhookEvent: input.webhookEvent,
    });
    if (renderedConversationKeyResult.status === "failed") {
      logTriggerSuppressionProbeSkipped({
        error: renderedConversationKeyResult.error,
        target,
        webhookEvent: input.webhookEvent,
      });
      queueableTargets.push({
        triggerRunId,
        target,
      });
      continue;
    }

    const renderedConversationKey = renderedConversationKeyResult.renderedConversationKey;
    const routedConversation = await db.query.triggerConversations.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq, ne }) =>
        and(
          eq(table.organizationId, input.webhookEvent.organizationId),
          eq(table.ownerKind, TriggerConversationOwnerKinds.TRIGGER_TARGET),
          eq(table.ownerId, target.triggerTargetId),
          eq(table.conversationKey, renderedConversationKey),
          ne(table.status, TriggerConversationStatuses.CLOSED),
        ),
    });
    if (routedConversation === undefined) {
      queueableTargets.push({
        triggerRunId,
        target,
      });
      continue;
    }

    const activeRoute = await db.query.triggerConversationRoutes.findFirst({
      columns: {
        id: true,
        sandboxInstanceId: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.conversationId, routedConversation.id),
          eq(table.status, TriggerConversationRouteStatuses.ACTIVE),
        ),
    });
    const associationDelivery =
      activeRoute === undefined
        ? undefined
        : associationDeliveriesBySandboxInstanceId.get(activeRoute.sandboxInstanceId);
    if (activeRoute === undefined || associationDelivery === undefined) {
      queueableTargets.push({
        triggerRunId,
        target,
      });
      continue;
    }

    logSuppressedDuplicateTriggerMatch({
      associationDelivery,
      conversationId: routedConversation.id,
      sandboxInstanceId: activeRoute.sandboxInstanceId,
      target,
      webhookEvent: input.webhookEvent,
    });
    suppressedTargets.push(target);
  }

  return {
    queueableTargetRuns: queueableTargets,
    suppressedTargets,
  };
}

function renderTriggerConversationKey(input: {
  target: ResolvedWebhookTriggerTarget;
  triggerRunId: string;
  webhookEvent: IntegrationWebhookEvent;
}):
  | {
      status: "rendered";
      renderedConversationKey: string;
    }
  | {
      status: "failed";
      error: unknown;
    } {
  try {
    const renderedConversationKey = renderTemplateString({
      template: input.target.conversationKeyTemplate,
      context: {
        webhookEvent: {
          id: input.webhookEvent.id,
          eventType: input.webhookEvent.eventType,
          providerEventType: input.webhookEvent.providerEventType,
          externalEventId: input.webhookEvent.externalEventId,
          externalDeliveryId: input.webhookEvent.externalDeliveryId,
        },
        triggerRun: {
          id: input.triggerRunId,
          triggerId: input.target.triggerId,
          triggerTargetId: input.target.triggerTargetId,
        },
        payload: input.webhookEvent.payload,
      },
    });
    if (renderedConversationKey.trim().length === 0) {
      throw new Error("Rendered trigger conversation key template must not be empty.");
    }

    return {
      status: "rendered",
      renderedConversationKey,
    };
  } catch (error) {
    return {
      status: "failed",
      error,
    };
  }
}

function logSuppressedDuplicateTriggerMatch(input: {
  associationDelivery: QueuedProviderResourceAssociationDelivery;
  conversationId: string;
  sandboxInstanceId: string;
  target: ResolvedWebhookTriggerTarget;
  webhookEvent: IntegrationWebhookEvent;
}): void {
  logWebhookDeliveryEvent({
    eventName: "trigger_match.suppressed_by_association_delivery",
    message:
      "Suppressed duplicate trigger match because association delivery targets the same sandbox session.",
    telemetryContext: {
      webhookEventId: input.webhookEvent.id,
      externalDeliveryId: input.webhookEvent.externalDeliveryId ?? undefined,
      conversationId: input.conversationId,
      integrationConnectionId: input.webhookEvent.integrationConnectionId,
      targetKey: input.webhookEvent.targetKey,
    },
    attributes: {
      "mistle.trigger.id": input.target.triggerId,
      "mistle.trigger.target_id": input.target.triggerTargetId,
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.provider_resource_association.id":
        input.associationDelivery.providerResourceAssociationId,
      "mistle.provider_resource_association.delivery_id": input.associationDelivery.deliveryId,
    },
  });
}

function logTriggerSuppressionProbeSkipped(input: {
  error: unknown;
  target: ResolvedWebhookTriggerTarget;
  webhookEvent: IntegrationWebhookEvent;
}): void {
  logWebhookDeliveryEvent({
    eventName: "trigger_match.suppression_probe_skipped",
    level: "warn",
    message:
      "Skipped duplicate trigger suppression probe because the trigger conversation key could not be rendered.",
    telemetryContext: {
      webhookEventId: input.webhookEvent.id,
      externalDeliveryId: input.webhookEvent.externalDeliveryId ?? undefined,
      integrationConnectionId: input.webhookEvent.integrationConnectionId,
      targetKey: input.webhookEvent.targetKey,
    },
    attributes: {
      "mistle.trigger.id": input.target.triggerId,
      "mistle.trigger.target_id": input.target.triggerTargetId,
    },
    err: input.error,
  });
}

async function markExistingSuppressedTriggerRunsIgnored(
  db: ControlPlaneDatabase,
  input: {
    sourceWebhookEventId: string;
    suppressedTargets: ReadonlyArray<ResolvedWebhookTriggerTarget>;
  },
): Promise<void> {
  if (input.suppressedTargets.length === 0) {
    return;
  }

  const tables = getControlPlaneDatabaseSchema(db);
  await db
    .update(tables.triggerRuns)
    .set({
      status: TriggerRunStatuses.IGNORED,
      failureCode: "association_delivery_preferred",
      failureMessage:
        "Association delivery targets the same sandbox session for this provider webhook event.",
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.triggerRuns.sourceWebhookEventId, input.sourceWebhookEventId),
        eq(tables.triggerRuns.status, TriggerRunStatuses.QUEUED),
        inArray(
          tables.triggerRuns.triggerTargetId,
          input.suppressedTargets.map((target) => target.triggerTargetId),
        ),
      ),
    );
}

async function insertQueuedTriggerRuns(
  db: ControlPlaneDatabase,
  input: {
    sourceWebhookEventId: string;
    targetRuns: ReadonlyArray<ResolvedWebhookTriggerTargetRun>;
  },
): Promise<ReadonlyArray<string>> {
  if (input.targetRuns.length === 0) {
    return [];
  }

  const tables = getControlPlaneDatabaseSchema(db);
  await db
    .insert(tables.triggerRuns)
    .values(
      input.targetRuns.map((targetRun) => ({
        id: targetRun.triggerRunId,
        triggerId: targetRun.target.triggerId,
        triggerTargetId: targetRun.target.triggerTargetId,
        sourceWebhookEventId: input.sourceWebhookEventId,
        status: TriggerRunStatuses.QUEUED,
      })),
    )
    .onConflictDoNothing({
      target: [tables.triggerRuns.triggerTargetId, tables.triggerRuns.sourceWebhookEventId],
    });

  const queuedTriggerRuns = await db.query.triggerRuns.findMany({
    columns: {
      id: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.sourceWebhookEventId, input.sourceWebhookEventId),
        eq(table.status, TriggerRunStatuses.QUEUED),
        inArray(
          table.triggerTargetId,
          input.targetRuns.map((targetRun) => targetRun.target.triggerTargetId),
        ),
      ),
  });

  return queuedTriggerRuns.map((queuedRun) => queuedRun.id);
}

async function resolveRecoverableResourceSyncRequests(
  db: ControlPlaneDatabase,
  input: {
    webhookEvent: {
      integrationConnectionId: string;
      organizationId: string;
      sourceOccurredAt: string | null;
    };
    resourceSyncKinds: ReadonlyArray<string>;
  },
): Promise<ReadonlyArray<IntegrationWebhookResourceSyncRequest>> {
  if (input.resourceSyncKinds.length === 0) {
    return [];
  }

  const resourceStates = await db.query.integrationConnectionResourceStates.findMany({
    columns: {
      kind: true,
      lastSyncStartedAt: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.connectionId, input.webhookEvent.integrationConnectionId),
        inArray(table.kind, input.resourceSyncKinds),
      ),
  });
  const scheduledKinds = new Set(
    resourceStates
      .filter(
        (resourceState) =>
          resourceState.lastSyncStartedAt !== null &&
          input.webhookEvent.sourceOccurredAt !== null &&
          resourceState.lastSyncStartedAt >= input.webhookEvent.sourceOccurredAt,
      )
      .map((resourceState) => resourceState.kind),
  );

  return input.resourceSyncKinds
    .filter((kind) => !scheduledKinds.has(kind))
    .map((kind) => ({
      organizationId: input.webhookEvent.organizationId,
      connectionId: input.webhookEvent.integrationConnectionId,
      kind,
    }));
}
