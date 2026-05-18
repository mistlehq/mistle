import { describe, expect, test } from "vitest";

import {
  HandleTriggerConversationDeliveryWorkflowSpec,
  HandleTriggerRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
  ProvisionStripeCustomerWorkflowSpec,
  RequestDeleteSandboxProfileWorkflowSpec,
  ScheduleDispatchBatchWorkflowSpec,
  ScheduleDispatchWorkflowSpec,
  SendOrganizationInvitationWorkflowSpec,
  SendVerificationOTPWorkflowSpec,
  StartSandboxProfileInstanceWorkflowSpec,
  SyncIntegrationConnectionResourcesWorkflowSpec,
  createStripeCustomerProvisioningIdempotencyKey,
} from "./control-plane.js";

describe("control-plane workflow registry", () => {
  test("exports the expected workflow names and versions", () => {
    expect([
      SendVerificationOTPWorkflowSpec,
      SendOrganizationInvitationWorkflowSpec,
      ProvisionStripeCustomerWorkflowSpec,
      RequestDeleteSandboxProfileWorkflowSpec,
      StartSandboxProfileInstanceWorkflowSpec,
      HandleIntegrationWebhookEventWorkflowSpec,
      SyncIntegrationConnectionResourcesWorkflowSpec,
      HandleTriggerRunWorkflowSpec,
      HandleTriggerConversationDeliveryWorkflowSpec,
      ScheduleDispatchWorkflowSpec,
      ScheduleDispatchBatchWorkflowSpec,
    ]).toEqual([
      { name: "control-plane.auth.send-verification-otp", version: "1" },
      { name: "control-plane.auth.send-organization-invitation", version: "1" },
      { name: "control-plane.billing.provision-stripe-customer", version: "1" },
      { name: "control-plane.sandbox-profiles.request-delete-profile", version: "1" },
      { name: "control-plane.sandbox-instances.start-profile-instance", version: "1" },
      { name: "control-plane.integration-webhooks.handle-event", version: "1" },
      { name: "control-plane.integration-connections.sync-resources", version: "1" },
      { name: "control-plane.automations.handle-run", version: "1" },
      { name: "control-plane.automation-conversations.handle-delivery", version: "1" },
      { name: "control-plane.schedules.dispatch", version: "1" },
      { name: "control-plane.schedules.dispatch-batch", version: "1" },
    ]);
  });

  test("builds a stable Stripe customer provisioning idempotency key", () => {
    expect(createStripeCustomerProvisioningIdempotencyKey("org_123")).toBe(
      "organization:org_123:stripe-customer",
    );
  });
});
