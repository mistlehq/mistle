import {
  createSendVerificationOTPWorkflow,
  SendVerificationOTPWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const SendVerificationOTPWorkflow = defineWorkflow(
  SendVerificationOTPWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { emailDelivery },
    } = await getWorkflowContext();
    const workflow = createSendVerificationOTPWorkflow(emailDelivery);

    return workflow.fn(workflowContext);
  },
);
