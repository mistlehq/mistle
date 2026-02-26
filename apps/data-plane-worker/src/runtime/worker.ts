import { createDataPlaneWorker } from "@mistle/workflows/data-plane";

import type { DataPlaneWorkerConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";

export function createRuntimeWorker(input: {
  config: DataPlaneWorkerConfig;
  resources: Pick<WorkerRuntimeResources, "openWorkflow">;
}): ReturnType<typeof createDataPlaneWorker> {
  return createDataPlaneWorker({
    openWorkflow: input.resources.openWorkflow,
    concurrency: input.config.workflow.concurrency,
  });
}
