import {
  createSendOrganizationInvitationWorkflow,
  SendOrganizationInvitationWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const SendOrganizationInvitationWorkflow = defineWorkflow(
  SendOrganizationInvitationWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { emailDelivery },
    } = await getWorkflowContext();
    const workflow = createSendOrganizationInvitationWorkflow(emailDelivery);

    return workflow.fn(workflowContext);
  },
);
