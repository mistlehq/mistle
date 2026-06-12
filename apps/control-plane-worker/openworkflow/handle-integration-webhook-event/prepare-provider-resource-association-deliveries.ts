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
  type AssociatedResourceWebhookObservation,
  type IntegrationAssociatedResourceEventsCapability,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

import { supportsAssociatedResourceEvent } from "../shared/associated-resource-routing.js";
import { logWebhookDeliveryEvent } from "../shared/webhook-delivery-telemetry.js";

export type QueuedProviderResourceAssociationDelivery = {
  deliveryId: string;
  providerResourceAssociationId: string;
  sandboxInstanceId: string;
};

type ObservedAssociatedResourceEvent = {
  capability: IntegrationAssociatedResourceEventsCapability;
  connection: {
    config: Record<string, unknown> | null;
    id: string;
  };
  observation: AssociatedResourceWebhookObservation;
};

export async function prepareProviderResourceAssociationDeliveries(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    webhookEvent: IntegrationWebhookEvent;
  },
): Promise<ReadonlyArray<QueuedProviderResourceAssociationDelivery>> {
  const observedEvent = await observeAssociatedResourceEvent(ctx, input.webhookEvent);
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
        eq(table.resourceKind, observedEvent.observation.resourceKind),
        eq(table.providerResourceId, observedEvent.observation.providerResourceId),
      ),
  });
  if (associations.length === 0) {
    return [];
  }

  const queuedDeliveries: QueuedProviderResourceAssociationDelivery[] = [];
  let selfAuthored: boolean | undefined;
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
        eventType: observedEvent.observation.eventType,
        payload: input.webhookEvent.payload,
        resourceKind: observedEvent.observation.resourceKind,
        routing: sandboxInstance.associatedResourceEventRouting,
        sourceWebhookEventType: input.webhookEvent.eventType,
      })
    ) {
      continue;
    }
    selfAuthored ??= await isSelfAuthoredAssociatedResourceEvent(observedEvent);
    if (selfAuthored) {
      continue;
    }

    const deliveryId = await enqueueAssociationDeliveryAndEnsureProcessor(ctx.db, {
      providerResourceAssociationId: association.id,
      renderedInput: observedEvent.observation.renderedInput.text,
      sourceOrderKey: input.webhookEvent.sourceOrderKey,
      sourceWebhookEventId: input.webhookEvent.id,
    });
    queuedDeliveries.push({
      deliveryId,
      providerResourceAssociationId: association.id,
      sandboxInstanceId: association.sandboxInstanceId,
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
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  webhookEvent: IntegrationWebhookEvent,
): Promise<ObservedAssociatedResourceEvent | null> {
  const target = await ctx.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, webhookEvent.targetKey),
  });
  if (target === undefined) {
    return null;
  }

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  const capability = definition?.associatedResourceEvents;
  if (capability === undefined) {
    return null;
  }

  const observation = await capability.observeWebhookEvent({
    eventType: webhookEvent.eventType,
    payload: webhookEvent.payload,
  });
  if (observation === null) {
    return null;
  }

  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      config: true,
      id: true,
    },
    where: (table, { eq }) => eq(table.id, webhookEvent.integrationConnectionId),
  });
  if (connection === undefined) {
    throw new Error(
      `Integration connection '${webhookEvent.integrationConnectionId}' for webhook event '${webhookEvent.id}' was not found.`,
    );
  }

  return {
    capability,
    connection,
    observation,
  };
}

async function isSelfAuthoredAssociatedResourceEvent(
  observedEvent: ObservedAssociatedResourceEvent,
): Promise<boolean> {
  if (observedEvent.capability.isSelfAuthoredEvent === undefined) {
    return false;
  }

  return await observedEvent.capability.isSelfAuthoredEvent({
    connection: observedEvent.connection,
    observation: observedEvent.observation,
  });
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
