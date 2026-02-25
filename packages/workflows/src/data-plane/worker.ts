import type { OpenWorkflow, Worker } from "openworkflow";

import { createDataPlaneWorkflowDefinitions } from "./workflows/index.js";

export type CreateDataPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  concurrency: number;
};

/**
 * Creates a data-plane OpenWorkflow worker and registers all workflows.
 */
export function createDataPlaneWorker(input: CreateDataPlaneWorkerInput): Worker {
  const workflows = createDataPlaneWorkflowDefinitions();
  for (const workflow of workflows) {
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }

  return input.openWorkflow.newWorker({ concurrency: input.concurrency });
}
