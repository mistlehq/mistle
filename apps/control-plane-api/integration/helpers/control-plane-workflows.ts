import { createControlPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { sql } from "drizzle-orm";
import { z } from "zod";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

const WorkflowRunInputSchema = z.looseObject({});

export type QueuedControlPlaneWorkflowRun = {
  input: Record<string, unknown>;
  idempotencyKey: string | null;
};

export async function waitForQueuedControlPlaneWorkflowInput(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}) {
  const workflowRun = await waitForQueuedControlPlaneWorkflowRun(input);
  return workflowRun.input;
}

export async function waitForQueuedControlPlaneWorkflowRun(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}): Promise<QueuedControlPlaneWorkflowRun> {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const workflowRun = await findQueuedControlPlaneWorkflowRun(input);
    if (workflowRun !== null) {
      return workflowRun;
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(`Timed out waiting for queued workflow '${input.workflowName}'.`);
}

export async function findQueuedControlPlaneWorkflowRun(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}): Promise<QueuedControlPlaneWorkflowRun | null> {
  const workflowNamespaceId = createControlPlaneWorkflowNamespaceId(input.env.id);
  const result = await input.env.controlPlaneDb.execute(sql<{
    input: unknown;
    idempotencyKey: string | null;
  }>`
    select input, idempotency_key as "idempotencyKey"
    from control_plane_openworkflow.workflow_runs
    where
      namespace_id = ${workflowNamespaceId}
      and workflow_name = ${input.workflowName}
      and input @> ${JSON.stringify(input.inputEquals)}::jsonb
    order by created_at desc
    limit 1
  `);
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    input: WorkflowRunInputSchema.parse(row.input),
    idempotencyKey: typeof row.idempotencyKey === "string" ? row.idempotencyKey : null,
  };
}

export async function countQueuedControlPlaneWorkflows(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}): Promise<number> {
  const workflowNamespaceId = createControlPlaneWorkflowNamespaceId(input.env.id);
  const result = await input.env.controlPlaneDb.execute(sql<{ count: string }>`
    select count(*)::text as count
    from control_plane_openworkflow.workflow_runs
    where
      namespace_id = ${workflowNamespaceId}
      and workflow_name = ${input.workflowName}
      and input @> ${JSON.stringify(input.inputEquals)}::jsonb
  `);

  return Number(result.rows[0]?.count ?? "0");
}
