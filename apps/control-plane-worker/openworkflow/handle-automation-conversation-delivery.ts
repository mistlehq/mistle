import {
  createHandleAutomationConversationDeliveryWorkflow,
  HandleAutomationConversationDeliveryWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const HandleAutomationConversationDeliveryWorkflow = defineWorkflow(
  HandleAutomationConversationDeliveryWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { automationConversationDelivery },
    } = await getWorkflowContext();
    const workflow = createHandleAutomationConversationDeliveryWorkflow(
      automationConversationDelivery,
    );

    return workflow.fn(workflowContext);
  },
);
