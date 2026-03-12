import {
  createStartSandboxProfileInstanceWorkflow,
  StartSandboxProfileInstanceWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const StartSandboxProfileInstanceWorkflow = defineWorkflow(
  StartSandboxProfileInstanceWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { sandboxInstances },
    } = await getWorkflowContext();
    const workflow = createStartSandboxProfileInstanceWorkflow({
      startSandboxInstance: sandboxInstances.startSandboxProfileInstance,
    });

    return workflow.fn(workflowContext);
  },
);
