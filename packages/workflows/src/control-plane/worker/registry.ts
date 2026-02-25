import type { OpenWorkflow } from "openworkflow";

import { registerWorkflows } from "../../core/register-workflows.js";
import { controlPlaneWorkflowDefinitions } from "../workflows/index.js";

export type RegisterControlPlaneWorkflowsInput = {
  openWorkflow: OpenWorkflow;
};

/**
 * Registers all control-plane workflow implementations against the client.
 */
export function registerControlPlaneWorkflows(input: RegisterControlPlaneWorkflowsInput): void {
  registerWorkflows({
    openWorkflow: input.openWorkflow,
    workflows: controlPlaneWorkflowDefinitions,
  });
}
