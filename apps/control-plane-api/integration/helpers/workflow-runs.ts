import { ControlPlaneOpenWorkflow } from "@mistle/workflows/control-plane";
import { Pool } from "pg";

type CountControlPlaneWorkflowRunsInput = {
  databaseUrl: string;
  workflowName: string;
  namespaceId?: string;
  inputEquals?: Record<string, string>;
};

function assertSafeJsonFieldKey(field: string): void {
  if (!/^[a-zA-Z0-9_]+$/u.test(field)) {
    throw new Error(`Invalid workflow run input filter field '${field}'.`);
  }
}

export async function countControlPlaneWorkflowRuns(
  input: CountControlPlaneWorkflowRunsInput,
): Promise<number> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
  });

  try {
    const namespaceId = input.namespaceId ?? "integration";
    const filters = input.inputEquals ?? {};
    const filterEntries = Object.entries(filters);
    const whereClauses = ["wr.namespace_id = $1", "wr.workflow_name = $2"];
    const values = [namespaceId, input.workflowName];

    for (const [field, value] of filterEntries) {
      assertSafeJsonFieldKey(field);
      values.push(value);
      whereClauses.push(`wr.input ->> '${field}' = $${String(values.length)}`);
    }

    const queryResult = await pool.query<{ run_count: number | string }>(
      `
        select count(*)::int as run_count
        from ${ControlPlaneOpenWorkflow.SCHEMA}.workflow_runs wr
        where ${whereClauses.join(" and ")}
      `,
      values,
    );

    const runCount = queryResult.rows[0]?.run_count;
    if (typeof runCount === "number") {
      return runCount;
    }
    if (typeof runCount === "string") {
      const parsed = Number.parseInt(runCount, 10);
      if (Number.isInteger(parsed)) {
        return parsed;
      }
    }

    throw new Error("Expected workflow run count query to return a numeric count.");
  } finally {
    await pool.end();
  }
}
