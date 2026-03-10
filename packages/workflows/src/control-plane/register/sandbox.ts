import type { OpenWorkflow } from "openworkflow";

import type { ControlPlaneWorkerServices } from "../worker.js";
import { createRequestDeleteSandboxProfileWorkflow } from "../workflows/request-delete-sandbox-profile/index.js";
import { createStartSandboxProfileInstanceWorkflow } from "../workflows/start-sandbox-profile-instance/index.js";

const REQUEST_DELETE_SANDBOX_PROFILE_WORKFLOW_ID = "requestDeleteSandboxProfile";
const START_SANDBOX_PROFILE_INSTANCE_WORKFLOW_ID = "startSandboxProfileInstance";

export type RegisterControlPlaneSandboxWorkflowsInput = {
  openWorkflow: OpenWorkflow;
  enabledWorkflows: ReadonlyArray<string>;
  services: Pick<ControlPlaneWorkerServices, "sandboxProfiles" | "sandboxInstances">;
};

export function registerControlPlaneSandboxWorkflows(
  input: RegisterControlPlaneSandboxWorkflowsInput,
): void {
  if (input.enabledWorkflows.includes(REQUEST_DELETE_SANDBOX_PROFILE_WORKFLOW_ID)) {
    if (input.services.sandboxProfiles === undefined) {
      throw new Error(
        "Control-plane sandbox profiles service is required for requestDeleteSandboxProfile workflow.",
      );
    }

    const workflow = createRequestDeleteSandboxProfileWorkflow({
      deleteSandboxProfile: input.services.sandboxProfiles.deleteSandboxProfile,
    });
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }

  if (input.enabledWorkflows.includes(START_SANDBOX_PROFILE_INSTANCE_WORKFLOW_ID)) {
    if (input.services.sandboxInstances === undefined) {
      throw new Error(
        "Control-plane sandbox instances service is required for startSandboxProfileInstance workflow.",
      );
    }

    const workflow = createStartSandboxProfileInstanceWorkflow({
      startSandboxInstance: input.services.sandboxInstances.startSandboxProfileInstance,
    });
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
