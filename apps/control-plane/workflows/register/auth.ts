import type { OpenWorkflow } from "openworkflow";

import { createSendOrganizationInvitationWorkflow } from "../send-organization-invitation/index.js";
import { createSendVerificationOTPWorkflow } from "../send-verification-otp/index.js";
import type { ControlPlaneWorkerEmailDelivery } from "../worker.js";

const SEND_ORGANIZATION_INVITATION_WORKFLOW_ID = "sendOrganizationInvitation";
const SEND_VERIFICATION_OTP_WORKFLOW_ID = "sendVerificationOTP";

export type RegisterControlPlaneAuthWorkflowsInput = {
  openWorkflow: OpenWorkflow;
  enabledWorkflows: ReadonlyArray<string>;
  services: {
    emailDelivery?: ControlPlaneWorkerEmailDelivery;
  };
};

export function registerControlPlaneAuthWorkflows(
  input: RegisterControlPlaneAuthWorkflowsInput,
): void {
  if (input.enabledWorkflows.includes(SEND_ORGANIZATION_INVITATION_WORKFLOW_ID)) {
    if (input.services.emailDelivery === undefined) {
      throw new Error(
        "Control-plane email delivery service is required for sendOrganizationInvitation workflow.",
      );
    }

    const workflow = createSendOrganizationInvitationWorkflow(input.services.emailDelivery);
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }

  if (input.enabledWorkflows.includes(SEND_VERIFICATION_OTP_WORKFLOW_ID)) {
    if (input.services.emailDelivery === undefined) {
      throw new Error(
        "Control-plane email delivery service is required for sendVerificationOTP workflow.",
      );
    }

    const workflow = createSendVerificationOTPWorkflow(input.services.emailDelivery);
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
