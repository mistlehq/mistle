import type { OpenWorkflow, Worker } from "openworkflow";

import {
  createStartSandboxInstanceWorkflow,
  type StartSandboxInstanceWorkflowServices,
} from "./workflows/start-sandbox-instance/index.js";

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
    if (workflowId === DataPlaneWorkerWorkflowIds.START_SANDBOX_INSTANCE) {
      const startSandboxInstanceWorkflow = createStartSandboxInstanceWorkflow(
        input.services.startSandboxInstance,
      );
      input.openWorkflow.implementWorkflow(
        startSandboxInstanceWorkflow.spec,
        startSandboxInstanceWorkflow.fn,
      );
      continue;
    }

    return assertNever(workflowId);
  }

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}
