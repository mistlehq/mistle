import type {
  SandboxInstancePersistenceMode,
  SandboxInstanceSource,
  SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { defineWorkflowSpec } from "openworkflow";

import type {
  SandboxRuntimeProviderInput,
  StartSandboxInstanceWorkflowImageInput,
} from "./data-plane.js";

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

export const ProvisionStripeCustomerWorkflowName =
  "control-plane.billing.provision-stripe-customer";
export const ProvisionStripeCustomerWorkflowVersion = "1";

export type ProvisionStripeCustomerWorkflowInput = {
  organizationId: string;
  organizationName: string;
};

export type ProvisionStripeCustomerWorkflowOutput = {
  organizationId: string;
  stripeCustomerId: string;
};

export const ProvisionStripeCustomerWorkflowSpec = defineWorkflowSpec<
  ProvisionStripeCustomerWorkflowInput,
  ProvisionStripeCustomerWorkflowOutput
>({
  name: ProvisionStripeCustomerWorkflowName,
  version: ProvisionStripeCustomerWorkflowVersion,
});

export function createStripeCustomerProvisioningIdempotencyKey(organizationId: string): string {
  return `organization:${organizationId}:stripe-customer`;
}

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

export type StartSandboxProfileInstanceWorkflowInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  persistenceMode: SandboxInstancePersistenceMode;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxInstanceWorkflowImageInput;
  sandboxRuntime: SandboxRuntimeProviderInput;
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

export const HandleTriggerRunWorkflowName = "control-plane.automations.handle-run";
export const HandleTriggerRunWorkflowVersion = "1";

export type HandleTriggerRunWorkflowInput =
  | {
      triggerRunId: string;
      automationRunId?: undefined;
    }
  | {
      triggerRunId?: undefined;
      automationRunId: string;
    };

export type HandleTriggerRunWorkflowOutput = {
  triggerRunId: string;
};

export const HandleTriggerRunWorkflowSpec = defineWorkflowSpec<
  HandleTriggerRunWorkflowInput,
  HandleTriggerRunWorkflowOutput
>({
  name: HandleTriggerRunWorkflowName,
  version: HandleTriggerRunWorkflowVersion,
});

export const HandleTriggerConversationDeliveryWorkflowName =
  "control-plane.automation-conversations.handle-delivery";
export const HandleTriggerConversationDeliveryWorkflowVersion = "1";

export type HandleTriggerConversationDeliveryWorkflowInput = {
  conversationId: string;
  generation: number;
};

export type HandleTriggerConversationDeliveryWorkflowOutput = {
  conversationId: string;
  generation: number;
};

export const HandleTriggerConversationDeliveryWorkflowSpec = defineWorkflowSpec<
  HandleTriggerConversationDeliveryWorkflowInput,
  HandleTriggerConversationDeliveryWorkflowOutput
>({
  name: HandleTriggerConversationDeliveryWorkflowName,
  version: HandleTriggerConversationDeliveryWorkflowVersion,
});

export const ScheduleDispatchWorkflowName = "control-plane.schedules.dispatch";
export const ScheduleDispatchWorkflowVersion = "1";

export type ScheduleDispatchWorkflowInput = {
  cutoffMinute: string;
};

export type ScheduleDispatchWorkflowOutput = {
  pendingScheduledActionIds: string[];
  claimedScheduleCount: number;
  reachedMaxBatches: boolean;
};

export const ScheduleDispatchWorkflowSpec = defineWorkflowSpec<
  ScheduleDispatchWorkflowInput,
  ScheduleDispatchWorkflowOutput
>({
  name: ScheduleDispatchWorkflowName,
  version: ScheduleDispatchWorkflowVersion,
});

export const ScheduleDispatchBatchWorkflowName = "control-plane.schedules.dispatch-batch";
export const ScheduleDispatchBatchWorkflowVersion = "1";

export type ScheduleDispatchBatchWorkflowInput = {
  scheduledActionIds: string[];
};

export type ScheduleDispatchBatchWorkflowOutput = {
  scheduledActionIds: string[];
};

export const ScheduleDispatchBatchWorkflowSpec = defineWorkflowSpec<
  ScheduleDispatchBatchWorkflowInput,
  ScheduleDispatchBatchWorkflowOutput
>({
  name: ScheduleDispatchBatchWorkflowName,
  version: ScheduleDispatchBatchWorkflowVersion,
});
