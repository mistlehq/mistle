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
export function createControlPlaneWorker(ctx: CreateControlPlaneWorkerInput): Worker {
  const workflows = createControlPlaneWorkflowDefinitions(ctx.workflowInputs);
  ctx.openWorkflow.implementWorkflow(
    workflows.sendOrganizationInvitation.spec,
    workflows.sendOrganizationInvitation.fn,
  );
  ctx.openWorkflow.implementWorkflow(
    workflows.sendVerificationOTP.spec,
    workflows.sendVerificationOTP.fn,
  );
  ctx.openWorkflow.implementWorkflow(
    workflows.requestDeleteSandboxProfile.spec,
    workflows.requestDeleteSandboxProfile.fn,
  );

  return ctx.openWorkflow.newWorker({ concurrency: ctx.concurrency });
}
