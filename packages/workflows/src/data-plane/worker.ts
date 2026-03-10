import type { OpenWorkflow, Worker } from "openworkflow";

import { registerDataPlaneSandboxWorkflows } from "./register/index.js";
import type { StartSandboxInstanceWorkflowServices } from "./workflows/start-sandbox-instance/index.js";

export const DataPlaneWorkerWorkflowIds = {
  START_SANDBOX_INSTANCE: "startSandboxInstance",
} as const;

export type DataPlaneWorkerWorkflowId =
  (typeof DataPlaneWorkerWorkflowIds)[keyof typeof DataPlaneWorkerWorkflowIds];

export type DataPlaneWorkerServices = {
  startSandboxInstance: StartSandboxInstanceWorkflowServices;
};

export type CreateDataPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  maxConcurrentWorkflows: number;
  enabledWorkflows: ReadonlyArray<DataPlaneWorkerWorkflowId>;
  services: DataPlaneWorkerServices;
};

function assertNever(value: never): never {
  throw new Error(`Unsupported data-plane workflow id: ${String(value)}`);
}

/**
 * Creates a data-plane OpenWorkflow worker and registers enabled workflows.
 */
export function createDataPlaneWorker(input: CreateDataPlaneWorkerInput): Worker {
  for (const workflowId of input.enabledWorkflows) {
    switch (workflowId) {
      case DataPlaneWorkerWorkflowIds.START_SANDBOX_INSTANCE:
        continue;
    }

    return assertNever(workflowId);
  }

  registerDataPlaneSandboxWorkflows({
    openWorkflow: input.openWorkflow,
    enabledWorkflows: input.enabledWorkflows,
    services: input.services,
  });

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}
