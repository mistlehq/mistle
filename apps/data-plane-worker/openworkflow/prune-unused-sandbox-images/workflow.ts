import { PruneUnusedSandboxImagesWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { pruneUnusedSandboxImages } from "./prune-unused-sandbox-images.js";

export const PruneUnusedSandboxImagesWorkflow = defineTracedDataPlaneWorkflow(
  PruneUnusedSandboxImagesWorkflowSpec,
  async ({ input }) => {
    const ctx = await getWorkflowContext();
    return await pruneUnusedSandboxImages(ctx, input);
  },
);
