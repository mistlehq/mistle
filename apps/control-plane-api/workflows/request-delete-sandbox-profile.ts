import { sandboxProfiles } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "./context.js";

export type RequestDeleteSandboxProfileWorkflowInput = {
  organizationId: string;
  profileId: string;
};

export type RequestDeleteSandboxProfileWorkflowOutput = {
  profileId: string;
};

export const RequestDeleteSandboxProfileWorkflow = defineWorkflow<
  RequestDeleteSandboxProfileWorkflowInput,
  RequestDeleteSandboxProfileWorkflowOutput
>(
  {
    name: "control-plane.sandbox-profiles.request-delete-profile",
    version: "1",
  },
  async ({ input: { organizationId, profileId }, step }) => {
    const ctx = await getWorkflowContext();

    await step.run(
      {
        name: "delete-sandbox-profile",
      },
      async () => {
        await ctx.db
          .delete(sandboxProfiles)
          .where(
            and(
              eq(sandboxProfiles.id, profileId),
              eq(sandboxProfiles.organizationId, organizationId),
            ),
          );
      },
    );

    return {
      profileId,
    };
  },
);
