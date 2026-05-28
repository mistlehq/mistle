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

type MarkSandboxInstanceFailedOutcome = "already_failed" | "fence_mismatch" | "failed";

export async function markSandboxInstanceFailed(ctx: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  sandboxInstanceId: string;
  currentStatus: SandboxInstanceStatus;
  failureCode: string;
  failureMessage: string;
  stillPermitted?: () => Promise<boolean>;
}): Promise<MarkSandboxInstanceFailedOutcome> {
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

    if (lockedStatus === SandboxInstanceStatuses.FAILED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        tables: ctx.tables,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
      return "already_failed";
    }

    assertSandboxInstanceLifecycleStatus(lockedStatus);
    const transition = transitionSandboxLifecycle({
      status: lockedStatus,
      event: SandboxLifecycleEvents.FAILURE_RECORDED,
    });

    if (
      lockedStatus !== ctx.currentStatus ||
      transition.kind !== "transition" ||
      transition.to !== SandboxInstanceStatuses.FAILED
    ) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to failed.`,
      );
    }

    if (ctx.stillPermitted !== undefined && !(await ctx.stillPermitted())) {
      return "fence_mismatch";
    }

    const failedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.FAILED,
        stopReason: SandboxStopReasons.FAILED,
        stoppedAt: null,
        failedAt: sql`now()`,
        failureCode: ctx.failureCode,
        failureMessage: ctx.failureMessage,
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

    if (failedRows[0]?.status !== SandboxInstanceStatuses.FAILED) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to failed.`,
      );
    }

    await clearSandboxInstanceDeadlines({
      db: tx,
      tables: ctx.tables,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });

    return "failed";
  });

  if (outcome === "failed") {
    logger.info(
      {
        eventName: "sandbox.failed",
        sandboxInstanceId: ctx.sandboxInstanceId,
        previousStatus: ctx.currentStatus,
        status: SandboxInstanceStatuses.FAILED,
        failureCode: ctx.failureCode,
      },
      "Marked sandbox instance failed during reconciliation.",
    );
  }

  return outcome;
}
