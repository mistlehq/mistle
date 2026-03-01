import { defineWorkflow, type Workflow } from "openworkflow";

import type { StartSandboxInstanceWorkflowInput } from "../../../data-plane/workflows/start-sandbox-instance/spec.js";
import {
  StartSandboxProfileInstanceWorkflowSpec,
  type StartSandboxProfileInstanceWorkflowInput,
  type StartSandboxProfileInstanceWorkflowOutput,
} from "./spec.js";

export type CreateStartSandboxProfileInstanceWorkflowInput = {
  startSandboxInstance: (
    input: StartSandboxInstanceWorkflowInput,
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
      async () =>
        ctx.startSandboxInstance({
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          startedBy: workflowInput.startedBy,
          source: workflowInput.source,
          image: workflowInput.image,
        }),
    );

    return startedSandbox;
  });
}
