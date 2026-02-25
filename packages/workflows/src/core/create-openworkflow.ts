import type { BackendPostgres } from "openworkflow/postgres";

import { OpenWorkflow } from "openworkflow";

export type CreateOpenWorkflowInput = {
  backend: BackendPostgres;
};

/**
 * Creates an OpenWorkflow client instance.
 */
export function createOpenWorkflow(input: CreateOpenWorkflowInput): OpenWorkflow {
  return new OpenWorkflow({ backend: input.backend });
}
