import { RequestDeleteSandboxProfileWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { deleteSandboxProfile } from "./delete-sandbox-profile.js";

export const RequestDeleteSandboxProfileWorkflow = defineTracedControlPlaneWorkflow(
  RequestDeleteSandboxProfileWorkflowSpec,
  async ({ input: { organizationId, profileId }, step }) => {
    const { db } = await getWorkflowContext();

    await step.run({ name: "delete-sandbox-profile" }, async () => {
      await deleteSandboxProfile(
        {
          db,
        },
        {
          organizationId,
          profileId,
        },
      );
    });

    return {
      profileId,
    };
  },
);
