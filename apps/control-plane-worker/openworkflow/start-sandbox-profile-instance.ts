import { StartSandboxProfileInstanceWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";
import { startSandboxProfileInstance } from "../src/runtime/services/start-sandbox-profile-instance.js";

export const StartSandboxProfileInstanceWorkflow = defineWorkflow(
  StartSandboxProfileInstanceWorkflowSpec,
  async ({ input, step }) => {
    const { db, dataPlaneClient } = await getWorkflowContext();

    return step.run(
      {
        name: "start-sandbox-instance-in-data-plane",
      },
      async () => {
        return startSandboxProfileInstance(
          {
            db,
            dataPlaneSandboxInstancesClient: dataPlaneClient,
          },
          input,
        );
      },
    );
  },
);
