import { PruneUnusedSandboxImagesWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  PruneUnusedSandboxImagesAcceptedResponse,
  PruneUnusedSandboxImagesRequest,
} from "../../sandbox/sandbox-images/prune-unused/schema.js";

type PruneUnusedSandboxImagesContext = {
  openWorkflow: Pick<AppRuntimeResources["openWorkflow"], "runWorkflow">;
};

export async function pruneUnusedSandboxImages(
  ctx: PruneUnusedSandboxImagesContext,
  input: PruneUnusedSandboxImagesRequest,
): Promise<PruneUnusedSandboxImagesAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    PruneUnusedSandboxImagesWorkflowSpec,
    {
      cutoff: input.cutoff,
      targets: input.targets.map((target) => {
        if (target.connectionId === undefined) {
          return {
            organizationId: target.organizationId,
            provider: target.provider,
            referencedImages: target.referencedImages,
          };
        }

        return {
          organizationId: target.organizationId,
          provider: target.provider,
          connectionId: target.connectionId,
          referencedImages: target.referencedImages,
        };
      }),
    },
    {
      idempotencyKey: input.idempotencyKey,
    },
  );

  return {
    status: "accepted",
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
