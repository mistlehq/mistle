import { SendOrganizationInvitationWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { buildDashboardUrl } from "../../dashboard-url.js";
import { type createControlPlaneOpenWorkflow } from "../../openworkflow.js";

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;
const DashboardInvitationAcceptPath = "/invitations/accept";

type CreateSendOrganizationInvitationServiceInput = {
  openWorkflow: ControlPlaneOpenWorkflow;
  dashboardBaseUrl: string;
};

type SendOrganizationInvitationInput = {
  email: string;
  invitationId: string;
  organizationName: string;
  inviterDisplayName: string;
  inviterEmail: string;
  role: string;
};

function buildInvitationUrl(input: {
  dashboardBaseUrl: string;
  invitationId: string;
  email: string;
  organizationName: string;
  inviterEmail: string;
}): string {
  const url = new URL(buildDashboardUrl(input.dashboardBaseUrl, DashboardInvitationAcceptPath));
  url.searchParams.set("invitationId", input.invitationId);
  url.searchParams.set("email", input.email);
  url.searchParams.set("organizationName", input.organizationName);
  url.searchParams.set("invitedBy", input.inviterEmail);

  return url.toString();
}

export function createSendOrganizationInvitationService(
  input: CreateSendOrganizationInvitationServiceInput,
): (inviteInput: SendOrganizationInvitationInput) => Promise<void> {
  return async (inviteInput) => {
    const invitationUrl = buildInvitationUrl({
      dashboardBaseUrl: input.dashboardBaseUrl,
      invitationId: inviteInput.invitationId,
      email: inviteInput.email,
      organizationName: inviteInput.organizationName,
      inviterEmail: inviteInput.inviterEmail,
    });

    await input.openWorkflow.runWorkflow(SendOrganizationInvitationWorkflowSpec, {
      email: inviteInput.email,
      organizationName: inviteInput.organizationName,
      inviterDisplayName: inviteInput.inviterDisplayName,
      role: inviteInput.role,
      invitationUrl,
    });
  };
}
