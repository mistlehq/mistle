import type { OpenWorkflow } from "openworkflow";

import { registerWorkflows } from "../../core/register-workflows.js";
import { dataPlaneWorkflowDefinitions } from "../workflows/index.js";

export type RegisterDataPlaneWorkflowsInput = {
  openWorkflow: OpenWorkflow;
};

/**
 * Registers all data-plane workflow implementations against the client.
 */
export function registerDataPlaneWorkflows(input: RegisterDataPlaneWorkflowsInput): void {
  registerWorkflows({
    openWorkflow: input.openWorkflow,
    workflows: dataPlaneWorkflowDefinitions,
  });
}
