import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  ControlPlaneConstraintIds,
  type ControlPlaneDatabase,
  isControlPlaneUniqueViolation,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { SandboxRuntimeProviderInput } from "@mistle/workflow-registry/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";
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
  sandboxInstanceId: string | null;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  workflowRunId: string | null;
  state: string;
  errorCode: string | null;
}>;

type SnapshotRefreshJobResolution = Readonly<{
  job: SnapshotRefreshJob;
  kind: "active_existing" | "created" | "source_existing";
}>;

function assertScheduledSnapshotSandboxProvider(
  provider: string | null,
): SandboxRuntimeProviderInput["provider"] {
  if (provider === "docker" || provider === "e2b" || provider === "tensorlake") {
    return provider;
  }

  throw new Error(
    `Unsupported sandbox provider '${String(provider)}' for scheduled snapshot refresh.`,
  );
}

export async function dispatchSnapshotRefreshScheduledAction(
  ctx: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
    defaultBaseImage: string;
  },
  input: ScheduleDispatchTargetHandlerInput,
): Promise<ScheduleDispatchTargetHandlerResult> {
  const targetPayload = SnapshotRefreshTargetPayloadSchema.parse(input.targetPayload);
  let snapshotJobResolution = await createOrResolveSnapshotRefreshJob(ctx, {
    scheduledActionId: input.scheduledActionId,
    sandboxProfileId: targetPayload.sandboxProfileId,
    sandboxProfileVersion: targetPayload.sandboxProfileVersion,
  });
  const snapshotJob = snapshotJobResolution.job;

  if (snapshotJob.state !== SandboxProfileVersionSnapshotJobStates.QUEUED) {
    if (snapshotJobResolution.kind === "source_existing" && snapshotJob.workflowRunId === null) {
      if (
        snapshotJob.state === SandboxProfileVersionSnapshotJobStates.FAILED &&
        snapshotJob.errorCode === "snapshot_materialization_enqueue_failed"
      ) {
        await requeueFailedSnapshotJobWithoutWorkflowHandoff(ctx, {
          snapshotJobId: snapshotJob.id,
        });
        snapshotJobResolution = {
          ...snapshotJobResolution,
          job: {
            ...snapshotJob,
            state: SandboxProfileVersionSnapshotJobStates.QUEUED,
            errorCode: null,
          },
        };
      } else {
        throw new Error(
          `Snapshot job '${snapshotJob.id}' for scheduled action '${input.scheduledActionId}' is ${snapshotJob.state} without a workflow handoff.`,
        );
      }
    } else {
      return {
        targetWorkflowId: snapshotJob.workflowRunId,
      };
    }
  }

  const queuedSnapshotJobCandidate = snapshotJobResolution.job;
  let queuedSnapshotJob: SnapshotRefreshJob & { sandboxInstanceId: string };
  if (queuedSnapshotJobCandidate.sandboxInstanceId === null) {
    queuedSnapshotJob = await assignSandboxInstanceIdToQueuedSnapshotJob(ctx, {
      snapshotJobId: queuedSnapshotJobCandidate.id,
    });
  } else {
    queuedSnapshotJob = {
      ...queuedSnapshotJobCandidate,
      sandboxInstanceId: queuedSnapshotJobCandidate.sandboxInstanceId,
    };
  }

  try {
    const materializationTarget = await loadSnapshotRefreshMaterializationTarget(ctx, {
      organizationId: input.organizationId,
      sandboxProfileId: queuedSnapshotJob.sandboxProfileId,
      sandboxProfileVersion: queuedSnapshotJob.sandboxProfileVersion,
    });

    const materialization = await ctx.dataPlaneClient.materializeSandboxProfileVersionSnapshotJob({
      snapshotJobId: queuedSnapshotJob.id,
      sandboxInstanceId: queuedSnapshotJob.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: queuedSnapshotJob.sandboxProfileId,
      sandboxProfileVersion: queuedSnapshotJob.sandboxProfileVersion,
      snapshotPreparationScriptKind: materializationTarget.snapshotPreparationScriptKind,
      image: materializationTarget.image,
      sandboxRuntime: materializationTarget.sandboxRuntime,
    });

    return {
      targetWorkflowId: materialization.workflowRunId,
    };
  } catch (error) {
    await markQueuedSnapshotJobFailedToEnqueue(ctx, {
      snapshotJobId: queuedSnapshotJob.id,
      message: `Failed to enqueue scheduled snapshot refresh for sandbox profile '${queuedSnapshotJob.sandboxProfileId}' version '${String(queuedSnapshotJob.sandboxProfileVersion)}'.`,
    });
    throw error;
  }
}

function hasNonBlankScript(script: string | null): boolean {
  return script !== null && script.trim().length > 0;
}

async function loadSnapshotRefreshMaterializationTarget(
  ctx: {
    db: ControlPlaneDatabase;
    defaultBaseImage: string;
  },
  input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<{
  sandboxRuntime: SandboxRuntimeProviderInput;
  snapshotPreparationScriptKind: "setup" | "maintenance";
  image: {
    imageId: string;
    createdAt: string;
    kind: "base" | "snapshot";
    provider: SandboxRuntimeProviderInput["provider"];
  };
}> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const [sandboxProfileVersion] = await ctx.db
    .select({
      sandboxProvider: tables.sandboxProfileVersions.sandboxProvider,
      sandboxConnectionId: tables.sandboxProfileVersions.sandboxConnectionId,
      snapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
      maintenanceScript: tables.sandboxProfileVersions.maintenanceScript,
      sandboxVcpuCount: tables.sandboxProfileVersions.sandboxVcpuCount,
      sandboxMemoryMb: tables.sandboxProfileVersions.sandboxMemoryMb,
      sandboxDiskMb: tables.sandboxProfileVersions.sandboxDiskMb,
    })
    .from(tables.sandboxProfiles)
    .innerJoin(
      tables.sandboxProfileVersions,
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, tables.sandboxProfiles.id),
        eq(tables.sandboxProfileVersions.version, input.sandboxProfileVersion),
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.id, input.sandboxProfileId),
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
      ),
    );

  if (sandboxProfileVersion === undefined) {
    throw new Error(
      `Sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}' was not found for scheduled snapshot refresh.`,
    );
  }

  const provider = assertScheduledSnapshotSandboxProvider(sandboxProfileVersion.sandboxProvider);

  if (
    provider !== "docker" &&
    (sandboxProfileVersion.sandboxVcpuCount === null ||
      sandboxProfileVersion.sandboxMemoryMb === null)
  ) {
    throw new Error(
      `Sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}' is missing remote sandbox resources for scheduled snapshot refresh.`,
    );
  }

  const sandboxRuntime: SandboxRuntimeProviderInput = {
    provider,
    ...(sandboxProfileVersion.sandboxConnectionId === null
      ? {}
      : { connectionId: sandboxProfileVersion.sandboxConnectionId }),
    ...(sandboxProfileVersion.sandboxVcpuCount === null ||
    sandboxProfileVersion.sandboxMemoryMb === null
      ? {}
      : {
          resources: {
            vcpuCount: sandboxProfileVersion.sandboxVcpuCount,
            memoryMb: sandboxProfileVersion.sandboxMemoryMb,
            ...(sandboxProfileVersion.sandboxDiskMb === null
              ? {}
              : { diskMb: sandboxProfileVersion.sandboxDiskMb }),
          },
        }),
  };
  if (
    !hasNonBlankScript(sandboxProfileVersion.maintenanceScript) ||
    sandboxProfileVersion.snapshotImageId === null
  ) {
    return {
      sandboxRuntime,
      snapshotPreparationScriptKind: "setup",
      image: {
        imageId: ctx.defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: "base",
        provider: sandboxRuntime.provider,
      },
    };
  }

  const snapshotImageId = sandboxProfileVersion.snapshotImageId;
  return {
    sandboxRuntime,
    snapshotPreparationScriptKind: "maintenance",
    image: {
      imageId: snapshotImageId,
      createdAt: new Date().toISOString(),
      kind: "snapshot",
      provider: sandboxRuntime.provider,
    },
  };
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
  const sandboxInstanceId = typeid("sbi").toString();

  try {
    const [snapshotJob] = await ctx.db
      .insert(tables.sandboxProfileVersionSnapshotJobs)
      .values({
        sandboxProfileId: input.sandboxProfileId,
        sandboxProfileVersion: input.sandboxProfileVersion,
        sandboxInstanceId,
        trigger: SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        sourceScheduledActionId: input.scheduledActionId,
      })
      .returning({
        id: tables.sandboxProfileVersionSnapshotJobs.id,
        sandboxInstanceId: tables.sandboxProfileVersionSnapshotJobs.sandboxInstanceId,
        sandboxProfileId: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId,
        sandboxProfileVersion: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
        workflowRunId: tables.sandboxProfileVersionSnapshotJobs.workflowRunId,
        state: tables.sandboxProfileVersionSnapshotJobs.state,
        errorCode: tables.sandboxProfileVersionSnapshotJobs.errorCode,
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

async function assignSandboxInstanceIdToQueuedSnapshotJob(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    snapshotJobId: string;
  },
): Promise<SnapshotRefreshJob & { sandboxInstanceId: string }> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const sandboxInstanceId = typeid("sbi").toString();
  const [snapshotJob] = await ctx.db
    .update(tables.sandboxProfileVersionSnapshotJobs)
    .set({
      sandboxInstanceId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId),
        eq(
          tables.sandboxProfileVersionSnapshotJobs.state,
          SandboxProfileVersionSnapshotJobStates.QUEUED,
        ),
        isNull(tables.sandboxProfileVersionSnapshotJobs.sandboxInstanceId),
      ),
    )
    .returning({
      id: tables.sandboxProfileVersionSnapshotJobs.id,
      sandboxInstanceId: tables.sandboxProfileVersionSnapshotJobs.sandboxInstanceId,
      sandboxProfileId: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId,
      sandboxProfileVersion: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
      workflowRunId: tables.sandboxProfileVersionSnapshotJobs.workflowRunId,
      state: tables.sandboxProfileVersionSnapshotJobs.state,
      errorCode: tables.sandboxProfileVersionSnapshotJobs.errorCode,
    });

  if (snapshotJob?.sandboxInstanceId === undefined || snapshotJob.sandboxInstanceId === null) {
    throw new Error(
      `Queued snapshot job '${input.snapshotJobId}' could not be assigned a sandbox instance id.`,
    );
  }

  return {
    ...snapshotJob,
    sandboxInstanceId: snapshotJob.sandboxInstanceId,
  };
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
      sandboxInstanceId: true,
      sandboxProfileVersion: true,
      workflowRunId: true,
      state: true,
      errorCode: true,
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
      sandboxInstanceId: true,
      sandboxProfileVersion: true,
      workflowRunId: true,
      state: true,
      errorCode: true,
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

async function requeueFailedSnapshotJobWithoutWorkflowHandoff(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    snapshotJobId: string;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.sandboxProfileVersionSnapshotJobs)
    .set({
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId),
        eq(
          tables.sandboxProfileVersionSnapshotJobs.state,
          SandboxProfileVersionSnapshotJobStates.FAILED,
        ),
        isNull(tables.sandboxProfileVersionSnapshotJobs.workflowRunId),
        eq(
          tables.sandboxProfileVersionSnapshotJobs.errorCode,
          "snapshot_materialization_enqueue_failed",
        ),
      ),
    )
    .returning({
      id: tables.sandboxProfileVersionSnapshotJobs.id,
    });

  if (updatedRows.length !== 1) {
    throw new Error(
      `Expected failed snapshot job '${input.snapshotJobId}' without workflow handoff to be requeued.`,
    );
  }
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
