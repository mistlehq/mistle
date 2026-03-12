import { RequestDeleteSandboxProfileWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";
import { deleteSandboxProfile } from "../src/runtime/services/delete-sandbox-profile.js";

export const RequestDeleteSandboxProfileWorkflow = defineWorkflow(
  RequestDeleteSandboxProfileWorkflowSpec,
  async ({ input: { organizationId, profileId }, step }) => {
    const { db } = await getWorkflowContext();

    await step.run(
      {
        name: "delete-sandbox-profile",
      },
      async () => {
        await deleteSandboxProfile(
          {
            db,
          },
          {
            organizationId,
            profileId,
          },
        );
      },
    );

    return {
      profileId,
    };
  },
);
