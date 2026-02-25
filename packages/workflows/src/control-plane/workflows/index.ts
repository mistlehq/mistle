import type { OpenWorkflowDefinition } from "../../core/register-workflows.js";

/**
 * Control-plane workflow implementations.
 *
 * Start empty and add workflows under `workflows/<workflow-id>/`.
 */
export type ControlPlaneWorkflowDefinition = OpenWorkflowDefinition;

export const controlPlaneWorkflowDefinitions: ReadonlyArray<ControlPlaneWorkflowDefinition> = [];
