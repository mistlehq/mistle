import { defineWorkflow, type Workflow } from "openworkflow";

import {
  StartSandboxProfileInstanceWorkflowSpec,
  type StartSandboxProfileInstanceWorkflowInput,
  type StartSandboxProfileInstanceWorkflowOutput,
} from "./spec.js";

export type CreateStartSandboxProfileInstanceWorkflowInput = {
  startSandboxInstance: (
    input: StartSandboxProfileInstanceWorkflowInput,
  ) => Promise<StartSandboxProfileInstanceWorkflowOutput>;
};

/**
 * Creates a control-plane workflow that starts a sandbox instance through the data-plane API.
 */
export function createStartSandboxProfileInstanceWorkflow(
  ctx: CreateStartSandboxProfileInstanceWorkflowInput,
): Workflow<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  StartSandboxProfileInstanceWorkflowInput
> {
  return defineWorkflow(StartSandboxProfileInstanceWorkflowSpec, async (workflowCtx) => {
    const workflowInput = workflowCtx.input;
    const startedSandbox = await workflowCtx.step.run(
      { name: "start-sandbox-instance-in-data-plane" },
      async () => ctx.startSandboxInstance(workflowInput),
    );

    return startedSandbox;
  });
}
