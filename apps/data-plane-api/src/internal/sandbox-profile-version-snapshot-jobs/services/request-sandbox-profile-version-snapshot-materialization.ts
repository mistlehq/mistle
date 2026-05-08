import { BadRequestError } from "@mistle/http/errors.js";
import { MaterializeSandboxProfileVersionSnapshotWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import type { OpenWorkflow } from "openworkflow";

import type { DataPlaneApiConfig } from "../../../types.js";
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

function resolveSandboxRuntimeProvider(input: {
  requestedProvider?: MaterializeSandboxProfileVersionSnapshotJobRequest["sandboxRuntimeProvider"];
  configuredProvider: DataPlaneApiConfig["sandbox"]["provider"];
}): {
  provider: DataPlaneApiConfig["sandbox"]["provider"];
} {
  if (input.requestedProvider === undefined) {
    return {
      provider: input.configuredProvider,
    };
  }

  if (input.requestedProvider.provider !== input.configuredProvider) {
    throw new BadRequestError(
      "SANDBOX_RUNTIME_PROVIDER_UNAVAILABLE",
      `Sandbox runtime provider '${input.requestedProvider.provider}' is not available in this deployment.`,
    );
  }

  return input.requestedProvider;
}

export async function requestSandboxProfileVersionSnapshotMaterialization(
  ctx: {
    openWorkflow: OpenWorkflow;
    sandboxProvider: DataPlaneApiConfig["sandbox"]["provider"];
  },
  input: MaterializeSandboxProfileVersionSnapshotJobRequest,
): Promise<MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse> {
  const sandboxRuntimeProvider = resolveSandboxRuntimeProvider({
    requestedProvider: input.sandboxRuntimeProvider,
    configuredProvider: ctx.sandboxProvider,
  });
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
    {
      ...input,
      sandboxRuntimeProvider,
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
