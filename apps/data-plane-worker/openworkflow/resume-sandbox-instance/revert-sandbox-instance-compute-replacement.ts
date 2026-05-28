import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export async function revertSandboxInstanceComputeReplacement(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
  },
  input: {
    sandboxInstanceId: string;
    replacementProviderSandboxId: string;
    replacementComputeGeneration: number;
    previousProviderSandboxId: string | null;
    previousComputeGeneration: number;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      providerSandboxId: input.previousProviderSandboxId,
      computeGeneration: input.previousComputeGeneration,
      status: SandboxInstanceStatuses.STARTING,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        inArray(sandboxInstances.status, [
          SandboxInstanceStatuses.STARTED,
          SandboxInstanceStatuses.INITIALIZING,
        ]),
        eq(sandboxInstances.computeGeneration, input.replacementComputeGeneration),
        eq(sandboxInstances.providerSandboxId, input.replacementProviderSandboxId),
        isNull(sandboxInstances.deletedAt),
      ),
    )
    .returning({
      computeGeneration: sandboxInstances.computeGeneration,
    });

  if (updatedRows[0]?.computeGeneration !== input.previousComputeGeneration) {
    throw new Error(
      "Failed to revert replacement provider sandbox id while sandbox instance was still starting.",
    );
  }
}
