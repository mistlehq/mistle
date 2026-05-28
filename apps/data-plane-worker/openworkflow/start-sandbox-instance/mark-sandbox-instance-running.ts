import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import { eq, sql } from "drizzle-orm";

import { logger as dataPlaneWorkerLogger } from "../../logger.js";
import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";

export async function markSandboxInstanceRunning(
  ctx: {
    db: DataPlaneDatabase;
    logger?: MistleLogger | undefined;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;
  await ctx.db.transaction(async (tx) => {
    await applySandboxLifecycleEvent(
      {
        db: tx,
        logger: ctx.logger ?? dataPlaneWorkerLogger,
        tables: ctx.tables,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        event: SandboxLifecycleEvents.RUNTIME_READY,
      },
    );

    await tx
      .update(sandboxInstances)
      .set({
        startedAt: sql`now()`,
        stopReason: null,
        failedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(sandboxInstances.id, input.sandboxInstanceId));
  });

  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance?.status !== SandboxInstanceStatuses.RUNNING) {
    throw new Error("Failed to transition sandbox instance status to running.");
  }
}
