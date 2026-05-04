import { createControlPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { sql } from "drizzle-orm";
import { z } from "zod";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

const WorkflowRunInputSchema = z.looseObject({});

export async function waitForQueuedControlPlaneWorkflowInput(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;
  const workflowNamespaceId = createControlPlaneWorkflowNamespaceId(input.env.id);

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.controlPlaneDb.execute(sql<{ input: unknown }>`
      select input
      from control_plane_openworkflow.workflow_runs
      where
        namespace_id = ${workflowNamespaceId}
        and workflow_name = ${input.workflowName}
        and input @> ${JSON.stringify(input.inputEquals)}::jsonb
      order by created_at desc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return WorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(`Timed out waiting for queued workflow '${input.workflowName}'.`);
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
