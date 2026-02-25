import type { BackendPostgres } from "openworkflow/postgres";

import { createOpenWorkflow } from "../core/create-openworkflow.js";

export type CreateDataPlaneOpenWorkflowInput = {
  backend: BackendPostgres;
};

/**
 * Creates an OpenWorkflow client instance for data-plane producers.
 */
export function createDataPlaneOpenWorkflow(
  input: CreateDataPlaneOpenWorkflowInput,
): ReturnType<typeof createOpenWorkflow> {
  return createOpenWorkflow({ backend: input.backend });
}
