import {
  SandboxProfileVersionSnapshotJobStates,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  createSnapshotJobNotFoundError,
  createSnapshotJobOwnershipMismatchError,
  createSnapshotJobStateConflictError,
} from "./errors.js";

export async function claimSandboxProfileVersionSnapshotJob(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    snapshotJobId: string;
    workflowRunId: string;
  },
): Promise<{ status: "ok" }> {
  await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const [lockedRow] = await tx
      .select({
        state: tables.sandboxProfileVersionSnapshotJobs.state,
        workflowRunId: tables.sandboxProfileVersionSnapshotJobs.workflowRunId,
      })
      .from(tables.sandboxProfileVersionSnapshotJobs)
      .where(eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId))
      .for("update");

    if (lockedRow === undefined) {
      throw createSnapshotJobNotFoundError(input.snapshotJobId);
    }

    const actualState = lockedRow.state;
    const workflowRunId = lockedRow.workflowRunId;

    if (
      actualState === SandboxProfileVersionSnapshotJobStates.RUNNING &&
      workflowRunId === input.workflowRunId
    ) {
      return;
    }

    if (actualState !== SandboxProfileVersionSnapshotJobStates.QUEUED) {
      if (
        actualState === SandboxProfileVersionSnapshotJobStates.RUNNING &&
        workflowRunId !== input.workflowRunId
      ) {
        throw createSnapshotJobOwnershipMismatchError({
          snapshotJobId: input.snapshotJobId,
          workflowRunId,
        });
      }

      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job is not claimable for execution.",
      });
    }

    const updatedRows = await tx
      .update(tables.sandboxProfileVersionSnapshotJobs)
      .set({
        state: SandboxProfileVersionSnapshotJobStates.RUNNING,
        workflowRunId: input.workflowRunId,
        startedAt: sql`coalesce(${tables.sandboxProfileVersionSnapshotJobs.startedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId),
          eq(
            tables.sandboxProfileVersionSnapshotJobs.state,
            SandboxProfileVersionSnapshotJobStates.QUEUED,
          ),
        ),
      )
      .returning({
        id: tables.sandboxProfileVersionSnapshotJobs.id,
      });

    if (updatedRows[0] === undefined) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job could not be claimed for execution.",
      });
    }
  });

  return {
    status: "ok",
  };
}
