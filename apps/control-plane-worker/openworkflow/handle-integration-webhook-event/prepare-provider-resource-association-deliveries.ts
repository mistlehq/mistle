import {
  ControlPlaneInternalClientRequestError,
  type ControlPlaneInternalClient,
} from "@mistle/control-plane-internal-client";
import {
  ProviderResourceAssociationDeliveryProcessorStatuses,
  ProviderResourceAssociationDeliveryStatuses,
  type ControlPlaneDatabase,
  type IntegrationWebhookEvent,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import {
  type AssociatedResourceEventRouting,
  type AssociatedResourceEventType,
} from "@mistle/integrations-core";
import {
  GitHubFamilyId,
  observeGitHubAssociatedResourceFromWebhookEvent,
} from "@mistle/integrations-definitions/server";
import { sql } from "drizzle-orm";

import { logWebhookDeliveryEvent } from "../shared/webhook-delivery-telemetry.js";

export type QueuedProviderResourceAssociationDelivery = {
  deliveryId: string;
  providerResourceAssociationId: string;
};

export async function prepareProviderResourceAssociationDeliveries(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
  },
  input: {
    webhookEvent: IntegrationWebhookEvent;
  },
): Promise<ReadonlyArray<QueuedProviderResourceAssociationDelivery>> {
  const observedEvent = await observeAssociatedResourceEvent(ctx.db, input.webhookEvent);
  if (observedEvent === null) {
    return [];
  }

  if (input.webhookEvent.sourceOrderKey === null) {
    throw new Error(
      `Webhook event '${input.webhookEvent.id}' is missing sourceOrderKey for association delivery.`,
    );
  }

  const associations = await ctx.db.query.providerResourceAssociations.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.integrationConnectionId, input.webhookEvent.integrationConnectionId),
        eq(table.resourceKind, observedEvent.resourceKind),
        eq(table.providerResourceId, observedEvent.providerResourceId),
      ),
  });
  if (associations.length === 0) {
    return [];
  }

  const queuedDeliveries: QueuedProviderResourceAssociationDelivery[] = [];
  for (const association of associations) {
    const sandboxInstance = await resolveAssociationSandboxInstance(ctx, {
      associationId: association.id,
      organizationId: input.webhookEvent.organizationId,
      sandboxInstanceId: association.sandboxInstanceId,
      webhookEvent: input.webhookEvent,
    });
    if (
      sandboxInstance !== null &&
      !supportsAssociatedResourceEvent({
        eventType: observedEvent.eventType,
        resourceKind: observedEvent.resourceKind,
        routing: sandboxInstance.associatedResourceEventRouting,
      })
    ) {
      continue;
    }

    const deliveryId = await enqueueAssociationDeliveryAndEnsureProcessor(ctx.db, {
      providerResourceAssociationId: association.id,
      renderedInput: observedEvent.renderedInput.text,
      sourceOrderKey: input.webhookEvent.sourceOrderKey,
      sourceWebhookEventId: input.webhookEvent.id,
    });
    queuedDeliveries.push({
      deliveryId,
      providerResourceAssociationId: association.id,
    });
  }

  return queuedDeliveries;
}

async function resolveAssociationSandboxInstance(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "getSandboxInstance">;
  },
  input: {
    associationId: string;
    organizationId: string;
    sandboxInstanceId: string;
    webhookEvent: IntegrationWebhookEvent;
  },
): Promise<Awaited<ReturnType<ControlPlaneInternalClient["getSandboxInstance"]>> | null> {
  try {
    return await ctx.controlPlaneInternalClient.getSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });
  } catch (error) {
    if (!(error instanceof ControlPlaneInternalClientRequestError) || error.status !== 404) {
      throw error;
    }

    logWebhookDeliveryEvent({
      eventName: "provider_resource_association.sandbox_read_failed",
      level: "warn",
      message:
        "Queuing provider resource association delivery without a sandbox routing check because the associated sandbox instance could not be read.",
      telemetryContext: {
        webhookEventId: input.webhookEvent.id,
        externalDeliveryId: input.webhookEvent.externalDeliveryId ?? undefined,
        integrationConnectionId: input.webhookEvent.integrationConnectionId,
        targetKey: input.webhookEvent.targetKey,
      },
      attributes: {
        "mistle.provider_resource_association.id": input.associationId,
        "mistle.sandbox.instance_id": input.sandboxInstanceId,
      },
      err: error,
    });

    return null;
  }
}

async function observeAssociatedResourceEvent(
  db: ControlPlaneDatabase,
  webhookEvent: IntegrationWebhookEvent,
): Promise<ReturnType<typeof observeGitHubAssociatedResourceFromWebhookEvent>> {
  const target = await db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, webhookEvent.targetKey),
  });
  if (target?.familyId !== GitHubFamilyId) {
    return null;
  }

  return observeGitHubAssociatedResourceFromWebhookEvent({
    eventType: webhookEvent.eventType,
    payload: webhookEvent.payload,
  });
}

function supportsAssociatedResourceEvent(input: {
  eventType: AssociatedResourceEventType;
  resourceKind: string;
  routing: AssociatedResourceEventRouting | null;
}): boolean {
  if (input.routing === null || !input.routing.enabled) {
    return false;
  }

  return input.routing.resources.some(
    (resource) =>
      resource.resourceKind === input.resourceKind && resource.eventTypes.includes(input.eventType),
  );
}

async function enqueueAssociationDelivery(
  db: ControlPlaneDatabase,
  input: {
    providerResourceAssociationId: string;
    renderedInput: string;
    sourceOrderKey: string;
    sourceWebhookEventId: string;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(db);
  const insertedRows = await db
    .insert(tables.providerResourceAssociationDeliveries)
    .values({
      providerResourceAssociationId: input.providerResourceAssociationId,
      sourceWebhookEventId: input.sourceWebhookEventId,
      sourceOrderKey: input.sourceOrderKey,
      renderedInput: input.renderedInput,
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
      updatedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [
        tables.providerResourceAssociationDeliveries.providerResourceAssociationId,
        tables.providerResourceAssociationDeliveries.sourceWebhookEventId,
      ],
    })
    .returning({
      id: tables.providerResourceAssociationDeliveries.id,
    });

  const insertedRow = insertedRows[0];
  if (insertedRow !== undefined) {
    return insertedRow.id;
  }

  const existingDelivery = await db.query.providerResourceAssociationDeliveries.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.providerResourceAssociationId, input.providerResourceAssociationId),
        eq(table.sourceWebhookEventId, input.sourceWebhookEventId),
      ),
  });
  if (existingDelivery === undefined) {
    throw new Error("Expected existing provider resource association delivery after conflict.");
  }

  return existingDelivery.id;
}

async function enqueueAssociationDeliveryAndEnsureProcessor(
  db: ControlPlaneDatabase,
  input: {
    providerResourceAssociationId: string;
    renderedInput: string;
    sourceOrderKey: string;
    sourceWebhookEventId: string;
  },
): Promise<string> {
  return await db.transaction(async (tx) => {
    const deliveryId = await enqueueAssociationDelivery(tx, input);
    await ensureAssociationDeliveryProcessor(tx, {
      providerResourceAssociationId: input.providerResourceAssociationId,
    });

    return deliveryId;
  });
}

async function ensureAssociationDeliveryProcessor(
  db: ControlPlaneDatabase,
  input: {
    providerResourceAssociationId: string;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(db);
  await db
    .insert(tables.providerResourceAssociationDeliveryProcessors)
    .values({
      providerResourceAssociationId: input.providerResourceAssociationId,
      status: ProviderResourceAssociationDeliveryProcessorStatuses.IDLE,
      updatedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: tables.providerResourceAssociationDeliveryProcessors.providerResourceAssociationId,
    });
}
