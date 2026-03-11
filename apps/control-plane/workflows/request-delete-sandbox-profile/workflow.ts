import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { deleteSandboxProfile } from "../../src/worker/runtime/services/delete-sandbox-profile.js";
import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";

export type RequestDeleteSandboxProfileWorkflowInput = {
  organizationId: string;
  profileId: string;
};

export type RequestDeleteSandboxProfileWorkflowOutput = {
  profileId: string;
};

/**
 * Creates the sandbox profile deletion workflow implementation.
 */
export const RequestDeleteSandboxProfileWorkflow = defineWorkflow(
  defineWorkflowSpec<
    RequestDeleteSandboxProfileWorkflowInput,
    RequestDeleteSandboxProfileWorkflowOutput
  >({
    name: "control-plane.sandbox-profiles.request-delete-profile",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();
    await step.run({ name: "delete-sandbox-profile" }, async () => {
      await deleteSandboxProfile(
        {
          db: runtime.db,
        },
        {
          organizationId: workflowInput.organizationId,
          profileId: workflowInput.profileId,
        },
      );
    });

    return {
      profileId: workflowInput.profileId,
    };
  },
);

export const RequestDeleteSandboxProfileWorkflowSpec = RequestDeleteSandboxProfileWorkflow.spec;
