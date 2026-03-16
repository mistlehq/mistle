import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const StopSandboxInstanceWorkflow = defineWorkflow(
  StopSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<StopSandboxInstanceWorkflowOutput> => {
    const {
      services: { stopSandboxInstance },
    } = await getWorkflowContext();

    await step.run({ name: "stop-sandbox-instance" }, async () => {
      await stopSandboxInstance.stopSandboxInstance({
        sandboxInstanceId: input.sandboxInstanceId,
      });
    });

    return {
      sandboxInstanceId: input.sandboxInstanceId,
    };
  },
);
