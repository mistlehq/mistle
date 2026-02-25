import type { OpenWorkflowDefinition } from "../../core/register-workflows.js";

/**
 * Data-plane workflow implementations.
 */
export type DataPlaneWorkflowDefinition = OpenWorkflowDefinition;

export function createDataPlaneWorkflowDefinitions(): ReadonlyArray<DataPlaneWorkflowDefinition> {
  return [];
}
