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
  input.openWorkflow.implementWorkflow(
    workflows.sendVerificationOTP.spec,
    workflows.sendVerificationOTP.fn,
  );
  input.openWorkflow.implementWorkflow(
    workflows.requestDeleteSandboxProfile.spec,
    workflows.requestDeleteSandboxProfile.fn,
  );

  return input.openWorkflow.newWorker({ concurrency: input.concurrency });
}
