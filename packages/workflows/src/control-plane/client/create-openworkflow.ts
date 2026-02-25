import type { BackendPostgres } from "openworkflow/postgres";

import { OpenWorkflow } from "openworkflow";

export type CreateControlPlaneOpenWorkflowInput = {
  backend: BackendPostgres;
};

/**
 * Creates an OpenWorkflow client instance for control-plane producers.
 */
export function createControlPlaneOpenWorkflow(
  input: CreateControlPlaneOpenWorkflowInput,
): OpenWorkflow {
  return new OpenWorkflow({ backend: input.backend });
}
