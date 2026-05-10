import {
  type SandboxRuntimeProviderInput,
  MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
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

function createWorkflowSandboxRuntime(
  input: MaterializeSandboxProfileVersionSnapshotJobRequest["sandboxRuntime"],
): SandboxRuntimeProviderInput {
  const resources =
    input.resources === undefined
      ? undefined
      : {
          vcpuCount: input.resources.vcpuCount,
          memoryMb: input.resources.memoryMb,
          ...(input.resources.storageMb === undefined
            ? {}
            : { storageMb: input.resources.storageMb }),
        };

  return {
    provider: input.provider,
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    ...(resources === undefined ? {} : { resources }),
  };
}

export async function requestSandboxProfileVersionSnapshotMaterialization(
  ctx: {
    openWorkflow: OpenWorkflow;
  },
  input: MaterializeSandboxProfileVersionSnapshotJobRequest,
): Promise<MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
    {
      ...input,
      sandboxRuntime: createWorkflowSandboxRuntime(input.sandboxRuntime),
    },
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
