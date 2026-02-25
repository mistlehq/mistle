import type { OpenWorkflow } from "openworkflow";

import { controlPlaneWorkflowDefinitions } from "../workflows/index.js";

export type RegisterControlPlaneWorkflowsInput = {
  openWorkflow: OpenWorkflow;
};

/**
 * Registers all control-plane workflow implementations against the client.
 */
export function registerControlPlaneWorkflows(input: RegisterControlPlaneWorkflowsInput): void {
  for (const workflow of controlPlaneWorkflowDefinitions) {
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
