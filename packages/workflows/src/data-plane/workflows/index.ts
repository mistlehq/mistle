import {
  createStartSandboxInstanceWorkflow,
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowServices,
} from "./start-sandbox-instance/index.js";

/**
 * Data-plane workflow implementations.
 */
export type DataPlaneWorkflowDefinition = ReturnType<typeof createStartSandboxInstanceWorkflow>;

export type DataPlaneWorkflowDefinitions = {
  startSandboxInstance: ReturnType<typeof createStartSandboxInstanceWorkflow>;
};

export type CreateDataPlaneWorkflowDefinitionsInput = {
  startSandboxInstance: StartSandboxInstanceWorkflowServices;
};

export function createDataPlaneWorkflowDefinitions(
  input: CreateDataPlaneWorkflowDefinitionsInput,
): DataPlaneWorkflowDefinitions {
  return {
    startSandboxInstance: createStartSandboxInstanceWorkflow(input.startSandboxInstance),
  };
}

export { StartSandboxInstanceWorkflowSpec };
