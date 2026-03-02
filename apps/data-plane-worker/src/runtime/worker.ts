import { systemClock, systemSleeper } from "@mistle/time";
import { DataPlaneWorkerWorkflowIds, createDataPlaneWorker } from "@mistle/workflows/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";
import {
  createDataPlaneWorkerServices,
  createDefaultTunnelConnectAckPolicy,
} from "./services/index.js";

export function createRuntimeWorker(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow" | "sandboxAdapter">;
}): ReturnType<typeof createDataPlaneWorker> {
  return createDataPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    maxConcurrentWorkflows: ctx.config.app.workflow.concurrency,
    enabledWorkflows: [DataPlaneWorkerWorkflowIds.START_SANDBOX_INSTANCE],
    services: createDataPlaneWorkerServices({
      config: ctx.config,
      db: ctx.resources.db,
      sandboxAdapter: ctx.resources.sandboxAdapter,
      tunnelConnectAckPolicy: createDefaultTunnelConnectAckPolicy(ctx.config),
      clock: systemClock,
      sleeper: systemSleeper,
    }),
  });
}
