import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { sql } from "drizzle-orm";
import { z } from "zod";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

export const MaterializeWorkflowName = "data-plane.sandbox-profile-version-snapshots.materialize";
export const StartWorkflowName = "data-plane.sandbox-instances.start";
export const ResumeWorkflowName = "data-plane.sandbox-instances.resume";
export const StopWorkflowName = "data-plane.sandbox-instances.stop";
export const DeleteWorkflowName = "data-plane.sandbox-instances.delete";

const MaterializeWorkflowRunInputSchema = z.looseObject({
  snapshotJobId: z.string().min(1),
  sandboxProfileId: z.string().min(1),
  sandboxProfileVersion: z.number().int().min(1),
  image: z
    .object({
      imageId: z.string().min(1),
      createdAt: z.iso.datetime().optional(),
      kind: z.enum(["base", "snapshot"]),
      provider: z.enum(["docker", "e2b", "tensorlake"]),
    })
    .strict(),
  sandboxRuntime: z
    .object({
      provider: z.enum(["docker", "e2b", "tensorlake"]),
      connectionId: z.string().min(1).optional(),
      resources: z
        .object({
          vcpuCount: z.number().int(),
          memoryMb: z.number().int(),
          storageMb: z.number().int().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
});

const StartWorkflowRunInputSchema = z.looseObject({
  sandboxInstanceId: z.string().min(1),
  sandboxProfileVersion: z.number().int().min(1),
  startedBy: z
    .object({
      kind: z.enum(["user", "api_key", "system"]),
      id: z.string().min(1),
    })
    .strict(),
  actingUserId: z.string().min(1).optional(),
  purpose: z
    .enum(["session", "snapshot", "setup_assistant", "setup_check", "skills_discovery"])
    .optional(),
  image: z
    .object({
      imageId: z.string().min(1),
      createdAt: z.iso.datetime().optional(),
      kind: z.enum(["base", "snapshot"]),
      provider: z.enum(["docker", "e2b", "tensorlake"]).optional(),
    })
    .strict()
    .optional(),
  runtimePlan: CompiledRuntimePlanSchema,
  gitIdentity: z
    .object({
      name: z.string().min(1),
      email: z.string().min(1),
      signing: z
        .object({
          format: z.literal("ssh"),
          program: z.string().min(1),
          keyRef: z.string().min(1),
          organizationId: z.string().min(1),
          providerFamily: z.string().min(1),
          integrationConnectionId: z.string().min(1),
          actingUserId: z.string().min(1),
        })
        .optional(),
    })
    .optional(),
});

const ResumeWorkflowRunInputSchema = z.looseObject({
  sandboxInstanceId: z.string().min(1),
  actingUserId: z.string().min(1).optional(),
});

const UserStopWorkflowRunSchema = z
  .object({
    id: z.string().min(1),
    input: z
      .object({
        sandboxInstanceId: z.string().min(1),
        stopReason: z.literal("user"),
      })
      .strict(),
  })
  .strict();

const DeleteWorkflowRunSchema = z
  .object({
    id: z.string().min(1),
    input: z
      .object({
        sandboxInstanceId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export async function waitForQueuedMaterializeWorkflowInput(input: {
  env: IntegrationTestEnvironment;
  snapshotJobId: string;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<{ input: unknown }>`
      select input
      from data_plane_openworkflow.workflow_runs
      where
        workflow_name = ${MaterializeWorkflowName}
        and input->>'snapshotJobId' = ${input.snapshotJobId}
      order by created_at desc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return MaterializeWorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued snapshot materialization workflow input for snapshot job '${input.snapshotJobId}'.`,
  );
}

export async function waitForQueuedStartWorkflowInput(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<{ input: unknown }>`
      select input
      from data_plane_openworkflow.workflow_runs
      where
        workflow_name = ${StartWorkflowName}
        and input->>'sandboxInstanceId' = ${input.sandboxInstanceId}
      order by created_at desc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return StartWorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued start workflow input for sandbox '${input.sandboxInstanceId}'.`,
  );
}

export async function waitForQueuedResumeWorkflowInput(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<{ input: unknown }>`
      select input
      from data_plane_openworkflow.workflow_runs
      where
        workflow_name = ${ResumeWorkflowName}
        and input->>'sandboxInstanceId' = ${input.sandboxInstanceId}
      order by created_at desc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return ResumeWorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued resume workflow input for sandbox '${input.sandboxInstanceId}'.`,
  );
}

export async function waitForQueuedUserStopWorkflowRun(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<{ id: string; input: unknown }>`
      select id, input
      from data_plane_openworkflow.workflow_runs
      where
        workflow_name = ${StopWorkflowName}
        and input->>'sandboxInstanceId' = ${input.sandboxInstanceId}
      order by created_at asc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return UserStopWorkflowRunSchema.parse(row);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued user stop workflow for sandbox '${input.sandboxInstanceId}'.`,
  );
}

export async function waitForQueuedDeleteWorkflowRun(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<{ id: string; input: unknown }>`
      select id, input
      from data_plane_openworkflow.workflow_runs
      where
        workflow_name = ${DeleteWorkflowName}
        and input->>'sandboxInstanceId' = ${input.sandboxInstanceId}
      order by created_at asc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return DeleteWorkflowRunSchema.parse(row);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued delete workflow for sandbox '${input.sandboxInstanceId}'.`,
  );
}

export async function countQueuedDeleteWorkflowRuns(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<number> {
  const result = await input.env.dataPlaneDb.execute(sql<{ count: string }>`
    select count(*)::text as count
    from data_plane_openworkflow.workflow_runs
    where
      workflow_name = ${DeleteWorkflowName}
      and input->>'sandboxInstanceId' = ${input.sandboxInstanceId}
  `);

  return Number(result.rows[0]?.count ?? "0");
}
