import {
  ProviderResourceAssociationDeliveryProcessorStatuses,
  ProviderResourceAssociationDeliveryStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

export type EnsureProviderResourceAssociationDeliveryProcessorOutput = {
  providerResourceAssociationId: string;
  generation: number;
  shouldStart: boolean;
};

export async function ensureProviderResourceAssociationDeliveryProcessor(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    providerResourceAssociationId: string;
  },
): Promise<EnsureProviderResourceAssociationDeliveryProcessorOutput> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const insertedRows = await ctx.db
    .insert(tables.providerResourceAssociationDeliveryProcessors)
    .values({
      providerResourceAssociationId: input.providerResourceAssociationId,
      generation: 1,
      status: ProviderResourceAssociationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: tables.providerResourceAssociationDeliveryProcessors.providerResourceAssociationId,
    })
    .returning();
  const insertedProcessor = insertedRows[0];
  if (insertedProcessor !== undefined) {
    return {
      providerResourceAssociationId: insertedProcessor.providerResourceAssociationId,
      generation: insertedProcessor.generation,
      shouldStart: true,
    };
  }

  const updatedRows = await ctx.db
    .update(tables.providerResourceAssociationDeliveryProcessors)
    .set({
      generation: sql`${tables.providerResourceAssociationDeliveryProcessors.generation} + 1`,
      status: ProviderResourceAssociationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(
          tables.providerResourceAssociationDeliveryProcessors.providerResourceAssociationId,
          input.providerResourceAssociationId,
        ),
        eq(
          tables.providerResourceAssociationDeliveryProcessors.status,
          ProviderResourceAssociationDeliveryProcessorStatuses.IDLE,
        ),
      ),
    )
    .returning();
  const updatedProcessor = updatedRows[0];
  if (updatedProcessor !== undefined) {
    return {
      providerResourceAssociationId: updatedProcessor.providerResourceAssociationId,
      generation: updatedProcessor.generation,
      shouldStart: true,
    };
  }

  const existingProcessor =
    await ctx.db.query.providerResourceAssociationDeliveryProcessors.findFirst({
      where: (table, { eq: whereEq }) =>
        whereEq(table.providerResourceAssociationId, input.providerResourceAssociationId),
    });
  if (existingProcessor === undefined) {
    throw new Error(
      `Provider resource association delivery processor '${input.providerResourceAssociationId}' could not be loaded.`,
    );
  }

  return {
    providerResourceAssociationId: existingProcessor.providerResourceAssociationId,
    generation: existingProcessor.generation,
    shouldStart: false,
  };
}

export async function setProviderResourceAssociationDeliveryProcessorIdle(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    providerResourceAssociationId: string;
    generation: number;
  },
): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const updatedRows = await ctx.db
    .update(tables.providerResourceAssociationDeliveryProcessors)
    .set({
      status: ProviderResourceAssociationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
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
    .returning({
      providerResourceAssociationId:
        tables.providerResourceAssociationDeliveryProcessors.providerResourceAssociationId,
    });

  return updatedRows[0] !== undefined;
}

export async function idleProviderResourceAssociationDeliveryProcessorIfEmpty(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    providerResourceAssociationId: string;
    generation: number;
  },
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
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
      return false;
    }

    const activeDelivery = await tx.query.providerResourceAssociationDeliveries.findFirst({
      where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
        whereAnd(
          whereEq(table.providerResourceAssociationId, input.providerResourceAssociationId),
          whereOr(
            whereEq(table.status, ProviderResourceAssociationDeliveryStatuses.QUEUED),
            whereEq(table.status, ProviderResourceAssociationDeliveryStatuses.CLAIMED),
            whereEq(table.status, ProviderResourceAssociationDeliveryStatuses.DELIVERING),
          ),
        ),
    });
    if (activeDelivery !== undefined) {
      return false;
    }

    return await setProviderResourceAssociationDeliveryProcessorIdle(
      {
        db: tx,
      },
      input,
    );
  });
}

export async function startProviderResourceAssociationDeliveryProcessors(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    providerResourceAssociationIds: ReadonlyArray<string>;
  },
): Promise<ReadonlyArray<EnsureProviderResourceAssociationDeliveryProcessorOutput>> {
  const uniqueIds = [...new Set(input.providerResourceAssociationIds)];
  const handoffs: EnsureProviderResourceAssociationDeliveryProcessorOutput[] = [];

  for (const providerResourceAssociationId of uniqueIds) {
    const handoff = await ensureProviderResourceAssociationDeliveryProcessor(ctx, {
      providerResourceAssociationId,
    });
    handoffs.push(handoff);
  }

  return handoffs;
}

export async function isProviderResourceAssociationDeliveryProcessorRunning(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    providerResourceAssociationId: string;
    generation: number;
  },
): Promise<boolean> {
  const processor = await ctx.db.query.providerResourceAssociationDeliveryProcessors.findFirst({
    columns: {
      providerResourceAssociationId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.providerResourceAssociationId, input.providerResourceAssociationId),
        whereEq(table.generation, input.generation),
        whereEq(table.status, ProviderResourceAssociationDeliveryProcessorStatuses.RUNNING),
      ),
  });

  return processor !== undefined;
}
