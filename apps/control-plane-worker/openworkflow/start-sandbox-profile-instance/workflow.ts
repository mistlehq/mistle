import { StartSandboxProfileInstanceWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { startSandboxProfileInstance } from "./start-sandbox-profile-instance.js";

export const StartSandboxProfileInstanceWorkflow = defineTracedControlPlaneWorkflow(
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
