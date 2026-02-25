import type { OpenWorkflowDefinition } from "../../core/register-workflows.js";

/**
 * Data-plane workflow implementations.
 *
 * Start empty and add workflows under `workflows/<workflow-id>/`.
 */
export type DataPlaneWorkflowDefinition = OpenWorkflowDefinition;

export const dataPlaneWorkflowDefinitions: ReadonlyArray<DataPlaneWorkflowDefinition> = [];
