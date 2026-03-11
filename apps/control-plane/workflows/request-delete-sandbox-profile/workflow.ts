import { defineWorkflow, type Workflow } from "openworkflow";

import {
  RequestDeleteSandboxProfileWorkflowSpec,
  type RequestDeleteSandboxProfileWorkflowInput,
  type RequestDeleteSandboxProfileWorkflowOutput,
} from "./spec.js";

export type CreateRequestDeleteSandboxProfileWorkflowInput = {
  deleteSandboxProfile: (input: { organizationId: string; profileId: string }) => Promise<void>;
};

/**
 * Creates the sandbox profile deletion workflow implementation.
 */
export function createRequestDeleteSandboxProfileWorkflow(
  ctx: CreateRequestDeleteSandboxProfileWorkflowInput,
): Workflow<
  RequestDeleteSandboxProfileWorkflowInput,
  RequestDeleteSandboxProfileWorkflowOutput,
  RequestDeleteSandboxProfileWorkflowInput
> {
  return defineWorkflow(
    RequestDeleteSandboxProfileWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      await step.run({ name: "delete-sandbox-profile" }, async () => {
        await ctx.deleteSandboxProfile({
          organizationId: workflowInput.organizationId,
          profileId: workflowInput.profileId,
        });
      });

      return {
        profileId: workflowInput.profileId,
      };
    },
  );
}
