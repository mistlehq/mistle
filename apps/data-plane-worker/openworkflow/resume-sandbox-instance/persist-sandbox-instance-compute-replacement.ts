import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

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

  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      providerSandboxId: input.providerSandboxId,
      computeGeneration: nextComputeGeneration,
      status: SandboxInstanceStatuses.STARTING,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
        eq(sandboxInstances.computeGeneration, input.previousComputeGeneration),
      ),
    )
    .returning({
      computeGeneration: sandboxInstances.computeGeneration,
    });

  if (updatedRows[0]?.computeGeneration !== nextComputeGeneration) {
    throw new Error(
      "Failed to persist replacement provider sandbox id while sandbox instance was still starting.",
    );
  }

  return {
    computeGeneration: nextComputeGeneration,
  };
}
