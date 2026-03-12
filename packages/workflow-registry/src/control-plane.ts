import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { defineWorkflowSpec } from "openworkflow";

export type OTPVerificationType = "sign-in" | "email-verification" | "forget-password";

export const SendVerificationOTPWorkflowName = "control-plane.auth.send-verification-otp";
export const SendVerificationOTPWorkflowVersion = "1";

export type SendVerificationOTPWorkflowInput = {
  email: string;
  otp: string;
  type: OTPVerificationType;
  expiresInSeconds: number;
};

export type SendVerificationOTPWorkflowOutput = {
  messageId: string;
};

export const SendVerificationOTPWorkflowSpec = defineWorkflowSpec<
  SendVerificationOTPWorkflowInput,
  SendVerificationOTPWorkflowOutput
>({
  name: SendVerificationOTPWorkflowName,
  version: SendVerificationOTPWorkflowVersion,
});

export const SendOrganizationInvitationWorkflowName =
  "control-plane.auth.send-organization-invitation";
export const SendOrganizationInvitationWorkflowVersion = "1";

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
  name: SendOrganizationInvitationWorkflowName,
  version: SendOrganizationInvitationWorkflowVersion,
});

export const RequestDeleteSandboxProfileWorkflowName =
  "control-plane.sandbox-profiles.request-delete-profile";
export const RequestDeleteSandboxProfileWorkflowVersion = "1";

export type RequestDeleteSandboxProfileWorkflowInput = {
  organizationId: string;
  profileId: string;
};

export type RequestDeleteSandboxProfileWorkflowOutput = {
  profileId: string;
};

export const RequestDeleteSandboxProfileWorkflowSpec = defineWorkflowSpec<
  RequestDeleteSandboxProfileWorkflowInput,
  RequestDeleteSandboxProfileWorkflowOutput
>({
  name: RequestDeleteSandboxProfileWorkflowName,
  version: RequestDeleteSandboxProfileWorkflowVersion,
});

export const StartSandboxProfileInstanceWorkflowName =
  "control-plane.sandbox-instances.start-profile-instance";
export const StartSandboxProfileInstanceWorkflowVersion = "1";

export type StartSandboxProfileInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "kind" | "createdAt"
>;

export type StartSandboxProfileInstanceWorkflowInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxProfileInstanceWorkflowImageInput;
};

export type StartSandboxProfileInstanceWorkflowOutput = {
  workflowRunId: string;
  sandboxInstanceId: string;
};

export const StartSandboxProfileInstanceWorkflowSpec = defineWorkflowSpec<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput
>({
  name: StartSandboxProfileInstanceWorkflowName,
  version: StartSandboxProfileInstanceWorkflowVersion,
});

export const HandleIntegrationWebhookEventWorkflowName =
  "control-plane.integration-webhooks.handle-event";
export const HandleIntegrationWebhookEventWorkflowVersion = "1";

export type HandleIntegrationWebhookEventWorkflowInput = {
  webhookEventId: string;
};

export type HandleIntegrationWebhookEventWorkflowOutput = {
  webhookEventId: string;
};

export const HandleIntegrationWebhookEventWorkflowSpec = defineWorkflowSpec<
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput
>({
  name: HandleIntegrationWebhookEventWorkflowName,
  version: HandleIntegrationWebhookEventWorkflowVersion,
});

export const SyncIntegrationConnectionResourcesWorkflowName =
  "control-plane.integration-connections.sync-resources";
export const SyncIntegrationConnectionResourcesWorkflowVersion = "1";

export type SyncIntegrationConnectionResourcesWorkflowInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type SyncIntegrationConnectionResourcesWorkflowOutput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export const SyncIntegrationConnectionResourcesWorkflowSpec = defineWorkflowSpec<
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput
>({
  name: SyncIntegrationConnectionResourcesWorkflowName,
  version: SyncIntegrationConnectionResourcesWorkflowVersion,
});

export const HandleAutomationRunWorkflowName = "control-plane.automations.handle-run";
export const HandleAutomationRunWorkflowVersion = "1";

export type HandleAutomationRunWorkflowInput = {
  automationRunId: string;
};

export type HandleAutomationRunWorkflowOutput = {
  automationRunId: string;
};

export const HandleAutomationRunWorkflowSpec = defineWorkflowSpec<
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput
>({
  name: HandleAutomationRunWorkflowName,
  version: HandleAutomationRunWorkflowVersion,
});

export const HandleAutomationConversationDeliveryWorkflowName =
  "control-plane.automation-conversations.handle-delivery";
export const HandleAutomationConversationDeliveryWorkflowVersion = "1";

export type HandleAutomationConversationDeliveryWorkflowInput = {
  conversationId: string;
  generation: number;
};

export type HandleAutomationConversationDeliveryWorkflowOutput = {
  conversationId: string;
  generation: number;
};

export const HandleAutomationConversationDeliveryWorkflowSpec = defineWorkflowSpec<
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput
>({
  name: HandleAutomationConversationDeliveryWorkflowName,
  version: HandleAutomationConversationDeliveryWorkflowVersion,
});
