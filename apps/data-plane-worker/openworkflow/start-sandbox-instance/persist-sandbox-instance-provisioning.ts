import {
  SandboxInstanceStatuses,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function persistSandboxInstanceProvisioning(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    providerSandboxId: string;
  },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        providerSandboxId: input.providerSandboxId,
        status: SandboxInstanceStatuses.STARTING,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, SandboxInstanceStatuses.PENDING),
        ),
      )
      .returning({
        id: sandboxInstances.id,
      });

    if (updatedRows[0] === undefined) {
      throw new Error(
        "Failed to persist provider sandbox id while sandbox instance was still pending.",
      );
    }

    await tx
      .insert(sandboxInstanceRuntimePlans)
      .values({
        sandboxInstanceId: input.sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: input.runtimePlan,
        compiledFromProfileId: input.sandboxProfileId,
        compiledFromProfileVersion: input.sandboxProfileVersion,
      })
      .onConflictDoNothing({
        target: [
          sandboxInstanceRuntimePlans.sandboxInstanceId,
          sandboxInstanceRuntimePlans.revision,
        ],
      });
  });
}
