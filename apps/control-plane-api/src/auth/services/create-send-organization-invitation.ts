import {
  SendOrganizationInvitationWorkflowSpec,
  type createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

type CreateSendOrganizationInvitationServiceInput = {
  openWorkflow: ControlPlaneOpenWorkflow;
  invitationAcceptBaseUrl: string;
};

type SendOrganizationInvitationInput = {
  email: string;
  invitationId: string;
  organizationName: string;
  inviterDisplayName: string;
  role: string;
};

function buildInvitationUrl(input: {
  invitationAcceptBaseUrl: string;
  invitationId: string;
  email: string;
  organizationName: string;
  inviterDisplayName: string;
}): string {
  const url = new URL(input.invitationAcceptBaseUrl);
  url.searchParams.set("invitationId", input.invitationId);
  url.searchParams.set("email", input.email);
  url.searchParams.set("organizationName", input.organizationName);
  url.searchParams.set("invitedBy", input.inviterDisplayName);

  return url.toString();
}

export function createSendOrganizationInvitationService(
  input: CreateSendOrganizationInvitationServiceInput,
): (inviteInput: SendOrganizationInvitationInput) => Promise<void> {
  return async (inviteInput) => {
    const invitationUrl = buildInvitationUrl({
      invitationAcceptBaseUrl: input.invitationAcceptBaseUrl,
      invitationId: inviteInput.invitationId,
      email: inviteInput.email,
      organizationName: inviteInput.organizationName,
      inviterDisplayName: inviteInput.inviterDisplayName,
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
