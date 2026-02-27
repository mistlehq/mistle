import type { OpenWorkflow, Worker } from "openworkflow";

import type { OpenWorkflowDefinition } from "./register-workflows.js";
import { registerWorkflows } from "./register-workflows.js";

export type CreateOpenWorkflowWorkerInput = {
  openWorkflow: OpenWorkflow;
  workflows: ReadonlyArray<OpenWorkflowDefinition>;
  concurrency: number;
};

/**
 * Registers workflows and creates an OpenWorkflow worker.
 */
export function createOpenWorkflowWorker(input: CreateOpenWorkflowWorkerInput): Worker {
  registerWorkflows({
    openWorkflow: input.openWorkflow,
    workflows: input.workflows,
  });

  return input.openWorkflow.newWorker({ concurrency: input.concurrency });
}
