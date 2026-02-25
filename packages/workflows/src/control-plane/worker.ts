import type { OpenWorkflow, Worker } from "openworkflow";

import {
  createControlPlaneWorkflowDefinitions,
  type CreateControlPlaneWorkflowDefinitionsInput,
} from "./workflows/index.js";

export type CreateControlPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  concurrency: number;
  workflowInputs: CreateControlPlaneWorkflowDefinitionsInput;
};

/**
 * Creates a control-plane OpenWorkflow worker and registers all workflows.
 */
export function createControlPlaneWorker(input: CreateControlPlaneWorkerInput): Worker {
  const workflows = createControlPlaneWorkflowDefinitions(input.workflowInputs);
  for (const workflow of workflows) {
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }

  return input.openWorkflow.newWorker({ concurrency: input.concurrency });
}
