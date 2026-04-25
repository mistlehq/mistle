import { MaterializeSandboxProfileVersionSnapshotWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import type { OpenWorkflow } from "openworkflow";

import type {
  MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse,
  MaterializeSandboxProfileVersionSnapshotJobRequest,
} from "../../sandbox/sandbox-profile-version-snapshot-jobs/materialize-snapshot-job/schema.js";

function createSnapshotMaterializationIdempotencyKey(input: { snapshotJobId: string }): string {
  return JSON.stringify({
    version: 1,
    snapshotJobId: input.snapshotJobId,
  });
}

export async function requestSandboxProfileVersionSnapshotMaterialization(
  ctx: {
    openWorkflow: OpenWorkflow;
  },
  input: MaterializeSandboxProfileVersionSnapshotJobRequest,
): Promise<MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
    input,
    {
      idempotencyKey: createSnapshotMaterializationIdempotencyKey({
        snapshotJobId: input.snapshotJobId,
      }),
    },
  );

  return {
    status: "accepted",
    snapshotJobId: input.snapshotJobId,
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
