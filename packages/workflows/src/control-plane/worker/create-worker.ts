import type { OpenWorkflow, Worker } from "openworkflow";

import { createOpenWorkflowWorker } from "../../core/create-worker.js";
import { controlPlaneWorkflowDefinitions } from "../workflows/index.js";

export type CreateControlPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  concurrency: number;
};

/**
 * Creates a control-plane OpenWorkflow worker and registers all workflows.
 */
export function createControlPlaneWorker(input: CreateControlPlaneWorkerInput): Worker {
  return createOpenWorkflowWorker({
    openWorkflow: input.openWorkflow,
    workflows: controlPlaneWorkflowDefinitions,
    concurrency: input.concurrency,
  });
}
