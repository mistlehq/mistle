import { createControlPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { sql } from "drizzle-orm";

export async function countQueuedControlPlaneWorkflowRunsByIdempotencyKeyForIntegrationTest(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  idempotencyKey: string;
}): Promise<number> {
  const result = await input.env.controlPlaneDb.execute(sql<{ count: string }>`
    select count(*)::text as count
    from control_plane_openworkflow.workflow_runs
    where
      namespace_id = ${createControlPlaneWorkflowNamespaceId(input.env.id)}
      and workflow_name = ${input.workflowName}
      and idempotency_key = ${input.idempotencyKey}
  `);

  return Number(result.rows[0]?.count ?? "0");
}
