import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  ControlPlaneConstraintIds,
  type ControlPlaneDatabase,
  isControlPlaneUniqueViolation,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";
import { z } from "zod";

import type {
  ScheduleDispatchTargetHandlerInput,
  ScheduleDispatchTargetHandlerResult,
} from "./dispatch-scheduled-action.js";

const SnapshotRefreshTargetPayloadSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
  })
  .strict();

type SnapshotRefreshJob = Readonly<{
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  workflowRunId: string | null;
  state: string;
}>;

type SnapshotRefreshJobResolution = Readonly<{
  job: SnapshotRefreshJob;
  kind: "active_existing" | "created" | "source_existing";
}>;

export async function dispatchSnapshotRefreshScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
    defaultBaseImage: string;
  },
  input: ScheduleDispatchTargetHandlerInput,
): Promise<ScheduleDispatchTargetHandlerResult> {
  const targetPayload = SnapshotRefreshTargetPayloadSchema.parse(input.targetPayload);
  const snapshotJobResolution = await createOrResolveSnapshotRefreshJob(ctx, {
    scheduledActionId: input.scheduledActionId,
    sandboxProfileId: targetPayload.sandboxProfileId,
    sandboxProfileVersion: targetPayload.sandboxProfileVersion,
  });
  const snapshotJob = snapshotJobResolution.job;

  if (snapshotJob.state !== SandboxProfileVersionSnapshotJobStates.QUEUED) {
    if (snapshotJobResolution.kind === "source_existing" && snapshotJob.workflowRunId === null) {
      throw new Error(
        `Snapshot job '${snapshotJob.id}' for scheduled action '${input.scheduledActionId}' is ${snapshotJob.state} without a workflow handoff.`,
      );
    }

    return {
      targetWorkflowId: snapshotJob.workflowRunId,
    };
  }

  try {
    const materialization = await ctx.dataPlaneClient.materializeSandboxProfileVersionSnapshotJob({
      snapshotJobId: snapshotJob.id,
      sandboxInstanceId: typeid("sbi").toString(),
      organizationId: input.organizationId,
      sandboxProfileId: snapshotJob.sandboxProfileId,
      sandboxProfileVersion: snapshotJob.sandboxProfileVersion,
      image: {
        imageId: ctx.defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: "base",
      },
    });

    return {
      targetWorkflowId: materialization.workflowRunId,
    };
  } catch (error) {
    await markQueuedSnapshotJobFailedToEnqueue(ctx, {
      snapshotJobId: snapshotJob.id,
      message: `Failed to enqueue scheduled snapshot refresh for sandbox profile '${snapshotJob.sandboxProfileId}' version '${String(snapshotJob.sandboxProfileVersion)}'.`,
    });
    throw error;
  }
}

async function createOrResolveSnapshotRefreshJob(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduledActionId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<SnapshotRefreshJobResolution> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  try {
    const [snapshotJob] = await ctx.db
      .insert(tables.sandboxProfileVersionSnapshotJobs)
      .values({
        sandboxProfileId: input.sandboxProfileId,
        sandboxProfileVersion: input.sandboxProfileVersion,
        trigger: SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        sourceScheduledActionId: input.scheduledActionId,
      })
      .returning({
        id: tables.sandboxProfileVersionSnapshotJobs.id,
        sandboxProfileId: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId,
        sandboxProfileVersion: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
        workflowRunId: tables.sandboxProfileVersionSnapshotJobs.workflowRunId,
        state: tables.sandboxProfileVersionSnapshotJobs.state,
      });

    if (snapshotJob === undefined) {
      throw new Error(
        `Expected scheduled snapshot refresh job to be created for scheduled action '${input.scheduledActionId}'.`,
      );
    }

    return {
      job: snapshotJob,
      kind: "created",
    };
  } catch (error) {
    if (
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SNAPSHOT_JOB_SOURCE_SCHEDULED_ACTION,
      )
    ) {
      return {
        job: await loadSnapshotJobForScheduledAction(ctx, {
          scheduledActionId: input.scheduledActionId,
        }),
        kind: "source_existing",
      };
    }

    if (
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SNAPSHOT_JOB_ACTIVE_PER_VERSION,
      )
    ) {
      return {
        job: await loadActiveSnapshotJobForProfileVersion(ctx, {
          sandboxProfileId: input.sandboxProfileId,
          sandboxProfileVersion: input.sandboxProfileVersion,
        }),
        kind: "active_existing",
      };
    }

    throw error;
  }
}

async function loadSnapshotJobForScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    scheduledActionId: string;
  },
): Promise<SnapshotRefreshJob> {
  const snapshotJob = await ctx.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
    columns: {
      id: true,
      sandboxProfileId: true,
      sandboxProfileVersion: true,
      workflowRunId: true,
      state: true,
    },
    where: (table, { eq }) => eq(table.sourceScheduledActionId, input.scheduledActionId),
  });

  if (snapshotJob === undefined) {
    throw new Error(
      `Expected snapshot job for scheduled action '${input.scheduledActionId}' to exist after source uniqueness conflict.`,
    );
  }

  return snapshotJob;
}

async function loadActiveSnapshotJobForProfileVersion(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<SnapshotRefreshJob> {
  const snapshotJob = await ctx.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
    columns: {
      id: true,
      sandboxProfileId: true,
      sandboxProfileVersion: true,
      workflowRunId: true,
      state: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.sandboxProfileVersion, input.sandboxProfileVersion),
        inArray(table.state, [
          SandboxProfileVersionSnapshotJobStates.QUEUED,
          SandboxProfileVersionSnapshotJobStates.RUNNING,
        ]),
      ),
  });

  if (snapshotJob === undefined) {
    throw new Error(
      `Expected active snapshot job for sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}' to exist after active job conflict.`,
    );
  }

  return snapshotJob;
}

async function markQueuedSnapshotJobFailedToEnqueue(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    snapshotJobId: string;
    message: string;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  await ctx.db
    .update(tables.sandboxProfileVersionSnapshotJobs)
    .set({
      state: SandboxProfileVersionSnapshotJobStates.FAILED,
      finishedAt: sql`now()`,
      errorCode: "snapshot_materialization_enqueue_failed",
      errorMessage: input.message,
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
    );
}
