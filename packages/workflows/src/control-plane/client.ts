import type { BackendPostgres } from "openworkflow/postgres";

import { createOpenWorkflow } from "../core/create-openworkflow.js";

export type CreateControlPlaneOpenWorkflowInput = {
  backend: BackendPostgres;
};

/**
 * Creates an OpenWorkflow client instance for control-plane producers.
 */
export function createControlPlaneOpenWorkflow(
  input: CreateControlPlaneOpenWorkflowInput,
): ReturnType<typeof createOpenWorkflow> {
  return createOpenWorkflow({ backend: input.backend });
}
