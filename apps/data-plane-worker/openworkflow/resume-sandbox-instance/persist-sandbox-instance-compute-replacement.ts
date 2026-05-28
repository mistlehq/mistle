import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import { and, eq, isNull, sql } from "drizzle-orm";

import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";

export async function persistSandboxInstanceComputeReplacement(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
  },
  input: {
    sandboxInstanceId: string;
    providerSandboxId: string;
    previousComputeGeneration: number;
  },
): Promise<{
  computeGeneration: number;
}> {
  const { sandboxInstances } = ctx.tables;
  const nextComputeGeneration = input.previousComputeGeneration + 1;

  const replacementPersisted = await ctx.db.transaction(async (tx) => {
    const replacementRows = await tx
      .update(sandboxInstances)
      .set({
        providerSandboxId: input.providerSandboxId,
        computeGeneration: nextComputeGeneration,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
          eq(sandboxInstances.computeGeneration, input.previousComputeGeneration),
          isNull(sandboxInstances.deletedAt),
        ),
      )
      .returning({
        computeGeneration: sandboxInstances.computeGeneration,
      });

    if (replacementRows[0]?.computeGeneration !== nextComputeGeneration) {
      const existingReplacement = await tx.query.sandboxInstances.findFirst({
        columns: {
          status: true,
          providerSandboxId: true,
          computeGeneration: true,
        },
        where: (table, { and, eq, isNull }) =>
          and(eq(table.id, input.sandboxInstanceId), isNull(table.deletedAt)),
      });

      return (
        existingReplacement?.status === SandboxInstanceStatuses.STARTED &&
        existingReplacement.providerSandboxId === input.providerSandboxId &&
        existingReplacement.computeGeneration === nextComputeGeneration
      );
    }

    await applySandboxLifecycleEvent(
      {
        db: tx,
        tables: ctx.tables,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        event: SandboxLifecycleEvents.PROVIDER_START_ACCEPTED,
      },
    );

    return true;
  });

  if (!replacementPersisted) {
    throw new Error(
      "Failed to persist replacement provider sandbox id while sandbox instance was still starting.",
    );
  }

  return {
    computeGeneration: nextComputeGeneration,
  };
}
