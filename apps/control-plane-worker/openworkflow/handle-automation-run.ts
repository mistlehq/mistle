import {
  createHandleAutomationRunWorkflow,
  HandleAutomationRunWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const HandleAutomationRunWorkflow = defineWorkflow(
  HandleAutomationRunWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { automationRuns },
    } = await getWorkflowContext();
    const workflow = createHandleAutomationRunWorkflow(automationRuns);

    return workflow.fn(workflowContext);
  },
);
