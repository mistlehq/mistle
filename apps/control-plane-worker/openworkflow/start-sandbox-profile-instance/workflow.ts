import { StartSandboxProfileInstanceWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../core/context.js";
import { startSandboxProfileInstance } from "./start-sandbox-profile-instance.js";

export const StartSandboxProfileInstanceWorkflow = defineWorkflow(
  StartSandboxProfileInstanceWorkflowSpec,
  async ({ input, step }) => {
    const { db, dataPlaneClient } = await getWorkflowContext();

    return step.run({ name: "start-sandbox-instance-in-data-plane" }, async () =>
      startSandboxProfileInstance(
        {
          db,
          dataPlaneClient,
        },
        input,
      ),
    );
  },
);
