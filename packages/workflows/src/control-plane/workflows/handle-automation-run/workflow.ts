import { defineWorkflow, type Workflow } from "openworkflow";

import {
  HandleAutomationRunWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowOutput,
} from "./spec.js";

export type CreateHandleAutomationRunWorkflowInput = {
  handleAutomationRun: (
    input: HandleAutomationRunWorkflowInput,
  ) => Promise<HandleAutomationRunWorkflowOutput>;
};

export function createHandleAutomationRunWorkflow(
  input: CreateHandleAutomationRunWorkflowInput,
): Workflow<
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput,
  HandleAutomationRunWorkflowInput
> {
  return defineWorkflow(HandleAutomationRunWorkflowSpec, async ({ input: workflowInput, step }) => {
    return step.run({ name: "handle-automation-run" }, async () =>
      input.handleAutomationRun(workflowInput),
    );
  });
}
