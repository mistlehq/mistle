import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { sql } from "drizzle-orm";
import { z } from "zod";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

export const MaterializeWorkflowName = "data-plane.sandbox-profile-version-snapshots.materialize";

const MaterializeWorkflowRunInputSchema = z.looseObject({
  snapshotJobId: z.string().min(1),
  sandboxProfileId: z.string().min(1),
  sandboxProfileVersion: z.number().int().min(1),
  image: z
    .object({
      imageId: z.string().min(1),
      createdAt: z.iso.datetime().optional(),
      kind: z.literal("base"),
    })
    .strict(),
});

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
