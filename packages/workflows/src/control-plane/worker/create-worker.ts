import type { OpenWorkflow, Worker } from "openworkflow";

import { registerControlPlaneWorkflows } from "./registry.js";

export type CreateControlPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  concurrency: number;
};

/**
 * Creates a control-plane OpenWorkflow worker and registers all workflows.
 */
export function createControlPlaneWorker(input: CreateControlPlaneWorkerInput): Worker {
  registerControlPlaneWorkflows({ openWorkflow: input.openWorkflow });

  return input.openWorkflow.newWorker({ concurrency: input.concurrency });
}
