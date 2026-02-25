import type { OpenWorkflow, Workflow } from "openworkflow";

export type OpenWorkflowDefinition = Workflow<unknown, unknown, unknown>;

export type RegisterWorkflowsInput = {
  openWorkflow: OpenWorkflow;
  workflows: ReadonlyArray<OpenWorkflowDefinition>;
};

/**
 * Registers workflow implementations against an OpenWorkflow instance.
 */
export function registerWorkflows(input: RegisterWorkflowsInput): void {
  for (const workflow of input.workflows) {
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
