import { OpenWorkflow } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";

export type CreateOpenWorkflowInput = {
  backend: BackendPostgres;
};

/**
 * Creates an OpenWorkflow client instance.
 */
export function createOpenWorkflow(input: CreateOpenWorkflowInput): OpenWorkflow {
  return new OpenWorkflow({ backend: input.backend });
}
