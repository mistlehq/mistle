import type { Workflow } from "openworkflow";

/**
 * Control-plane workflow implementations.
 *
 * Start empty and add workflows under `workflows/<workflow-id>/`.
 */
export type ControlPlaneWorkflowDefinition = Workflow<unknown, unknown, unknown>;

export const controlPlaneWorkflowDefinitions: ReadonlyArray<ControlPlaneWorkflowDefinition> = [];
