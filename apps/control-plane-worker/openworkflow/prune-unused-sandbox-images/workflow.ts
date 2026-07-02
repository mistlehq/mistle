import { PruneUnusedSandboxImagesWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { pruneUnusedSandboxImages } from "./prune-unused-sandbox-images.js";

export const PruneUnusedSandboxImagesWorkflow = defineTracedControlPlaneWorkflow(
  PruneUnusedSandboxImagesWorkflowSpec,
  async () => {
    const ctx = await getWorkflowContext();
    return await pruneUnusedSandboxImages({
      db: ctx.db,
      tables: ctx.tables,
      dataPlaneClient: ctx.dataPlaneClient,
      now: new Date(),
    });
  },
);
