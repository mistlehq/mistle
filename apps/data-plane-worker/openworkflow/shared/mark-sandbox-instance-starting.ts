import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import { and, eq, isNull, sql } from "drizzle-orm";

import { applySandboxLifecycleEvent } from "./apply-sandbox-lifecycle-event.js";

export async function markSandboxInstanceStarting(ctx: {
  db: DataPlaneDatabase;
  logger?: MistleLogger | undefined;
  tables: Pick<DataPlaneTables, "sandboxInstances">;
  sandboxInstanceId: string;
}): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  await ctx.db.transaction(async (tx) => {
    await applySandboxLifecycleEvent(
      {
        db: tx,
        logger: ctx.logger,
        tables: ctx.tables,
      },
      {
        sandboxInstanceId: ctx.sandboxInstanceId,
        event: SandboxLifecycleEvents.PROVIDER_START_REQUESTED,
      },
    );

    await tx
      .update(sandboxInstances)
      .set({
        stoppedAt: null,
        stopReason: null,
        failedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(sandboxInstances.id, ctx.sandboxInstanceId), isNull(sandboxInstances.deletedAt)),
      );
  });

  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, ctx.sandboxInstanceId),
  });

  if (sandboxInstance?.status !== SandboxInstanceStatuses.STARTING) {
    throw new Error("Failed to transition sandbox instance status to starting.");
  }
}
