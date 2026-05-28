import { isDeepStrictEqual } from "node:util";

import { type DataPlaneDatabase, type DataPlaneTables } from "@mistle/db/data-plane";
import { SandboxInstanceStatuses, SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";

import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";

export async function persistSandboxInstanceProvisioning(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstanceRuntimePlans" | "sandboxInstances">;
  },
  input: {
    sandboxInstanceId: string;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    providerSandboxId: string;
  },
): Promise<void> {
  const { sandboxInstanceRuntimePlans, sandboxInstances } = ctx.tables;
  await ctx.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        providerSandboxId: input.providerSandboxId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
          isNull(sandboxInstances.deletedAt),
        ),
      )
      .returning({
        id: sandboxInstances.id,
      });

    if (updatedRows[0] === undefined) {
      const existingSandboxInstance = await tx.query.sandboxInstances.findFirst({
        columns: {
          providerSandboxId: true,
          status: true,
        },
        where: (table, { and, eq, isNull }) =>
          and(eq(table.id, input.sandboxInstanceId), isNull(table.deletedAt)),
      });
      const existingRuntimePlan = await tx.query.sandboxInstanceRuntimePlans.findFirst({
        columns: {
          compiledRuntimePlan: true,
          compiledFromProfileId: true,
          compiledFromProfileVersion: true,
        },
        where: (table, { and, eq }) =>
          and(eq(table.sandboxInstanceId, input.sandboxInstanceId), eq(table.revision, 1)),
      });
      if (
        existingSandboxInstance?.status !== SandboxInstanceStatuses.STARTED ||
        existingSandboxInstance.providerSandboxId !== input.providerSandboxId ||
        existingRuntimePlan === undefined ||
        existingRuntimePlan.compiledFromProfileId !== input.sandboxProfileId ||
        existingRuntimePlan.compiledFromProfileVersion !== input.sandboxProfileVersion ||
        !isDeepStrictEqual(existingRuntimePlan.compiledRuntimePlan, input.runtimePlan)
      ) {
        throw new Error(
          "Failed to persist provider sandbox id while sandbox instance was still starting.",
        );
      }
      return;
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
