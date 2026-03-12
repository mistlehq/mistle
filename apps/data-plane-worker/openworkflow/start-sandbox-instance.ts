import {
  createStartSandboxInstanceWorkflow,
  StartSandboxInstanceWorkflowSpec,
} from "@mistle/workflows/data-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const StartSandboxInstanceWorkflow = defineWorkflow(
  StartSandboxInstanceWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { startSandboxInstance },
    } = await getWorkflowContext();
    const workflow = createStartSandboxInstanceWorkflow(startSandboxInstance);

    return workflow.fn(workflowContext);
  },
);
