import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import {
  assertSandboxInstanceLifecycleStatus,
  SandboxLifecycleEvents,
  transitionSandboxLifecycle,
} from "@mistle/sandbox-lifecycle";
import { and, eq, sql } from "drizzle-orm";

import { logger } from "../../logger.js";
import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

type MarkSandboxInstanceStoppedOutcome = "already_stopped" | "fence_mismatch" | "stopped";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  sandboxInstanceId: string;
  currentStatus: SandboxInstanceStatus;
  clearProviderSandboxId?: boolean;
  stillPermitted?: () => Promise<boolean>;
}): Promise<MarkSandboxInstanceStoppedOutcome> {
  const { sandboxInstances } = ctx.tables;
  const outcome = await ctx.db.transaction(async (tx) => {
    const lockedRows = await tx.execute(
      sql<{ status: string }>`
        select status
        from ${sandboxInstances}
        where id = ${ctx.sandboxInstanceId}
        for update
      `,
    );
    const lockedRow = lockedRows.rows[0];

    if (lockedRow === undefined) {
      throw new Error(`Sandbox instance '${ctx.sandboxInstanceId}' was not found.`);
    }
    const lockedStatus = lockedRow.status;
    if (typeof lockedStatus !== "string") {
      throw new Error(`Sandbox instance '${ctx.sandboxInstanceId}' returned a non-string status.`);
    }

    if (lockedStatus === SandboxInstanceStatuses.STOPPED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        tables: ctx.tables,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
      return "already_stopped";
    }

    if (lockedStatus !== ctx.currentStatus) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
      );
    }

    if (ctx.currentStatus === SandboxInstanceStatuses.STOPPING) {
      assertSandboxInstanceLifecycleStatus(lockedStatus);
      const transition = transitionSandboxLifecycle({
        status: lockedStatus,
        event: SandboxLifecycleEvents.PROVIDER_STOPPED,
      });
      if (transition.kind !== "transition" || transition.to !== SandboxInstanceStatuses.STOPPED) {
        throw new Error(
          `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
        );
      }
    }

    if (ctx.stillPermitted !== undefined && !(await ctx.stillPermitted())) {
      return "fence_mismatch";
    }

    const stoppedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.STOPPED,
        ...(ctx.clearProviderSandboxId === true ? { providerSandboxId: null } : {}),
        stoppedAt: sql`now()`,
        failedAt: null,
        stopReason: SandboxStopReasons.DISCONNECTED,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, ctx.sandboxInstanceId),
          eq(sandboxInstances.status, ctx.currentStatus),
        ),
      )
      .returning({
        status: sandboxInstances.status,
      });

    if (stoppedRows[0]?.status !== SandboxInstanceStatuses.STOPPED) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
      );
    }

    await clearSandboxInstanceDeadlines({
      db: tx,
      tables: ctx.tables,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });

    return "stopped";
  });

  if (outcome === "stopped") {
    logger.info(
      {
        eventName: "sandbox.stopped",
        sandboxInstanceId: ctx.sandboxInstanceId,
        previousStatus: ctx.currentStatus,
        status: SandboxInstanceStatuses.STOPPED,
      },
      "Marked sandbox instance stopped during reconciliation.",
    );
  }

  return outcome;
}
