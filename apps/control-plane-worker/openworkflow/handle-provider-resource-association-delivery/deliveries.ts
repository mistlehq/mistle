import {
  ProviderResourceAssociationDeliveryProcessorStatuses,
  ProviderResourceAssociationDeliveryStatuses,
  type ProviderResourceAssociationDeliveryStatus,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, or, sql } from "drizzle-orm";

import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

const FinalDeliveryStatuses = new Set<ProviderResourceAssociationDeliveryStatus>([
  ProviderResourceAssociationDeliveryStatuses.COMPLETED,
  ProviderResourceAssociationDeliveryStatuses.FAILED,
  ProviderResourceAssociationDeliveryStatuses.IGNORED,
]);

export type ActiveProviderResourceAssociationDelivery = {
  id: string;
  providerResourceAssociationId: string;
  sourceWebhookEventId: string;
  sourceOrderKey: string;
  renderedInput: string;
  status: "claimed" | "delivering";
  attemptCount: number;
  processorGeneration: number;
};

export async function claimOrResumeProviderResourceAssociationDelivery(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    providerResourceAssociationId: string;
    generation: number;
  },
): Promise<ActiveProviderResourceAssociationDelivery | null> {
  return await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const processorRows = await tx
      .select({
        providerResourceAssociationId:
          tables.providerResourceAssociationDeliveryProcessors.providerResourceAssociationId,
      })
      .from(tables.providerResourceAssociationDeliveryProcessors)
      .where(
        and(
          eq(
            tables.providerResourceAssociationDeliveryProcessors.providerResourceAssociationId,
            input.providerResourceAssociationId,
          ),
          eq(tables.providerResourceAssociationDeliveryProcessors.generation, input.generation),
          eq(
            tables.providerResourceAssociationDeliveryProcessors.status,
            ProviderResourceAssociationDeliveryProcessorStatuses.RUNNING,
          ),
        ),
      )
      .for("update");
    if (processorRows[0] === undefined) {
      return null;
    }

    const activeDelivery = await tx.query.providerResourceAssociationDeliveries.findFirst({
      where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
        whereAnd(
          whereEq(table.providerResourceAssociationId, input.providerResourceAssociationId),
          whereEq(table.processorGeneration, input.generation),
          whereOr(
            whereEq(table.status, ProviderResourceAssociationDeliveryStatuses.CLAIMED),
            whereEq(table.status, ProviderResourceAssociationDeliveryStatuses.DELIVERING),
          ),
        ),
      orderBy: (table, { asc }) => [
        asc(table.claimedAt),
        asc(table.deliveryStartedAt),
        asc(table.createdAt),
        asc(table.id),
      ],
    });
    if (activeDelivery !== undefined) {
      return {
        id: activeDelivery.id,
        providerResourceAssociationId: activeDelivery.providerResourceAssociationId,
        sourceWebhookEventId: activeDelivery.sourceWebhookEventId,
        sourceOrderKey: activeDelivery.sourceOrderKey,
        renderedInput: activeDelivery.renderedInput,
        status:
          activeDelivery.status === ProviderResourceAssociationDeliveryStatuses.CLAIMED
            ? "claimed"
            : "delivering",
        attemptCount: activeDelivery.attemptCount,
        processorGeneration: input.generation,
      };
    }

    const nextDelivery = await tx.query.providerResourceAssociationDeliveries.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.providerResourceAssociationId, input.providerResourceAssociationId),
          whereEq(table.status, ProviderResourceAssociationDeliveryStatuses.QUEUED),
        ),
      orderBy: (table, { asc }) => [asc(table.sourceOrderKey), asc(table.createdAt), asc(table.id)],
    });
    if (nextDelivery === undefined) {
      return null;
    }

    const updatedRows = await tx
      .update(tables.providerResourceAssociationDeliveries)
      .set({
        status: ProviderResourceAssociationDeliveryStatuses.CLAIMED,
        processorGeneration: input.generation,
        attemptCount: sql`${tables.providerResourceAssociationDeliveries.attemptCount} + 1`,
        claimedAt: sql`now()`,
        deliveryStartedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.providerResourceAssociationDeliveries.id, nextDelivery.id),
          eq(
            tables.providerResourceAssociationDeliveries.status,
            ProviderResourceAssociationDeliveryStatuses.QUEUED,
          ),
        ),
      )
      .returning();
    const updatedDelivery = updatedRows[0];
    if (updatedDelivery === undefined) {
      return null;
    }

    return {
      id: updatedDelivery.id,
      providerResourceAssociationId: updatedDelivery.providerResourceAssociationId,
      sourceWebhookEventId: updatedDelivery.sourceWebhookEventId,
      sourceOrderKey: updatedDelivery.sourceOrderKey,
      renderedInput: updatedDelivery.renderedInput,
      status: "claimed",
      attemptCount: updatedDelivery.attemptCount,
      processorGeneration: input.generation,
    };
  });
}

export async function markProviderResourceAssociationDeliveryDelivering(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    deliveryId: string;
    generation: number;
  },
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.providerResourceAssociationDeliveries)
    .set({
      status: ProviderResourceAssociationDeliveryStatuses.DELIVERING,
      deliveryStartedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.providerResourceAssociationDeliveries.id, input.deliveryId),
        eq(tables.providerResourceAssociationDeliveries.processorGeneration, input.generation),
        eq(
          tables.providerResourceAssociationDeliveries.status,
          ProviderResourceAssociationDeliveryStatuses.CLAIMED,
        ),
      ),
    )
    .returning();

  const updatedDelivery = updatedRows[0];
  if (updatedDelivery !== undefined) {
    return updatedDelivery;
  }

  const existingDelivery = await ctx.db.query.providerResourceAssociationDeliveries.findFirst({
    where: (table, { eq }) => eq(table.id, input.deliveryId),
  });
  if (
    existingDelivery?.status === ProviderResourceAssociationDeliveryStatuses.DELIVERING &&
    existingDelivery.processorGeneration === input.generation
  ) {
    return existingDelivery;
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_NOT_CLAIMED,
    message: `Provider resource association delivery '${input.deliveryId}' is not claimed.`,
  });
}

export async function finalizeProviderResourceAssociationDelivery(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    deliveryId: string;
    generation: number;
    status: ProviderResourceAssociationDeliveryStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  },
) {
  if (!FinalDeliveryStatuses.has(input.status)) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_STATUS_NOT_TERMINAL,
      message: `Provider resource association delivery status '${input.status}' is not terminal.`,
    });
  }

  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.providerResourceAssociationDeliveries)
    .set({
      status: input.status,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.providerResourceAssociationDeliveries.id, input.deliveryId),
        eq(tables.providerResourceAssociationDeliveries.processorGeneration, input.generation),
        or(
          eq(
            tables.providerResourceAssociationDeliveries.status,
            ProviderResourceAssociationDeliveryStatuses.CLAIMED,
          ),
          eq(
            tables.providerResourceAssociationDeliveries.status,
            ProviderResourceAssociationDeliveryStatuses.DELIVERING,
          ),
        ),
      ),
    )
    .returning();
  const updatedDelivery = updatedRows[0];
  if (updatedDelivery !== undefined) {
    return updatedDelivery;
  }

  const existingDelivery = await ctx.db.query.providerResourceAssociationDeliveries.findFirst({
    where: (table, { eq }) => eq(table.id, input.deliveryId),
  });
  if (
    existingDelivery?.status === input.status &&
    existingDelivery.processorGeneration === input.generation
  ) {
    return existingDelivery;
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_NOT_ACTIVE,
    message: `Provider resource association delivery '${input.deliveryId}' is not active.`,
  });
}

export async function releaseProviderResourceAssociationDeliveryForRetry(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    deliveryId: string;
    generation: number;
    failureCode: string;
    failureMessage: string;
  },
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.providerResourceAssociationDeliveries)
    .set({
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
      processorGeneration: null,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      claimedAt: null,
      deliveryStartedAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.providerResourceAssociationDeliveries.id, input.deliveryId),
        eq(tables.providerResourceAssociationDeliveries.processorGeneration, input.generation),
        or(
          eq(
            tables.providerResourceAssociationDeliveries.status,
            ProviderResourceAssociationDeliveryStatuses.CLAIMED,
          ),
          eq(
            tables.providerResourceAssociationDeliveries.status,
            ProviderResourceAssociationDeliveryStatuses.DELIVERING,
          ),
        ),
      ),
    )
    .returning();
  const updatedDelivery = updatedRows[0];
  if (updatedDelivery !== undefined) {
    return updatedDelivery;
  }

  const existingDelivery = await ctx.db.query.providerResourceAssociationDeliveries.findFirst({
    where: (table, { eq }) => eq(table.id, input.deliveryId),
  });
  if (existingDelivery?.status === ProviderResourceAssociationDeliveryStatuses.COMPLETED) {
    return existingDelivery;
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_NOT_ACTIVE,
    message: `Provider resource association delivery '${input.deliveryId}' could not be released for retry.`,
  });
}
