import { defineWorkflowSpec } from "openworkflow";

export type SendOrganizationInvitationWorkflowInput = {
  email: string;
  organizationName: string;
  inviterDisplayName: string;
  role: string;
  invitationUrl: string;
};

export type SendOrganizationInvitationWorkflowOutput = {
  messageId: string;
};

export const SendOrganizationInvitationWorkflowSpec = defineWorkflowSpec<
  SendOrganizationInvitationWorkflowInput,
  SendOrganizationInvitationWorkflowOutput
>({
  name: "control-plane.auth.send-organization-invitation",
  version: "1",
});
