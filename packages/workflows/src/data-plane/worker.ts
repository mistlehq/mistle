import type { OpenWorkflow, Worker } from "openworkflow";

import {
  createDataPlaneWorkflowDefinitions,
  type CreateDataPlaneWorkflowDefinitionsInput,
} from "./workflows/index.js";

export type CreateDataPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  concurrency: number;
  workflowInputs: CreateDataPlaneWorkflowDefinitionsInput;
};

/**
 * Creates a data-plane OpenWorkflow worker and registers all workflows.
 */
export function createDataPlaneWorker(input: CreateDataPlaneWorkerInput): Worker {
  const workflows = createDataPlaneWorkflowDefinitions(input.workflowInputs);
  input.openWorkflow.implementWorkflow(
    workflows.startSandboxInstance.spec,
    workflows.startSandboxInstance.fn,
  );

  return input.openWorkflow.newWorker({ concurrency: input.concurrency });
}
