import type { OpenWorkflow, Worker } from "openworkflow";

import { createOpenWorkflowWorker } from "../../core/create-worker.js";
import { dataPlaneWorkflowDefinitions } from "../workflows/index.js";

export type CreateDataPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  concurrency: number;
};

/**
 * Creates a data-plane OpenWorkflow worker and registers all workflows.
 */
export function createDataPlaneWorker(input: CreateDataPlaneWorkerInput): Worker {
  return createOpenWorkflowWorker({
    openWorkflow: input.openWorkflow,
    workflows: dataPlaneWorkflowDefinitions,
    concurrency: input.concurrency,
  });
}
