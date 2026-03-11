import type { OpenWorkflow } from "openworkflow";

import { createStartSandboxInstanceWorkflow } from "../start-sandbox-instance/index.js";
import type { DataPlaneWorkerServices } from "../worker.js";

const START_SANDBOX_INSTANCE_WORKFLOW_ID = "startSandboxInstance";

export type RegisterDataPlaneSandboxWorkflowsInput = {
  openWorkflow: OpenWorkflow;
  enabledWorkflows: ReadonlyArray<string>;
  services: Pick<DataPlaneWorkerServices, "startSandboxInstance">;
};

export function registerDataPlaneSandboxWorkflows(
  input: RegisterDataPlaneSandboxWorkflowsInput,
): void {
  if (input.enabledWorkflows.includes(START_SANDBOX_INSTANCE_WORKFLOW_ID)) {
    const workflow = createStartSandboxInstanceWorkflow(input.services.startSandboxInstance);
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
