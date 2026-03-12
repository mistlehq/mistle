import { describe, expect, test } from "vitest";

import {
  HandleAutomationConversationDeliveryWorkflowSpec,
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
  RequestDeleteSandboxProfileWorkflowSpec,
  SendOrganizationInvitationWorkflowSpec,
  SendVerificationOTPWorkflowSpec,
  StartSandboxProfileInstanceWorkflowSpec,
  SyncIntegrationConnectionResourcesWorkflowSpec,
} from "./control-plane.js";

describe("control-plane workflow registry", () => {
  test("exports the expected workflow names and versions", () => {
    expect([
      SendVerificationOTPWorkflowSpec,
      SendOrganizationInvitationWorkflowSpec,
      RequestDeleteSandboxProfileWorkflowSpec,
      StartSandboxProfileInstanceWorkflowSpec,
      HandleIntegrationWebhookEventWorkflowSpec,
      SyncIntegrationConnectionResourcesWorkflowSpec,
      HandleAutomationRunWorkflowSpec,
      HandleAutomationConversationDeliveryWorkflowSpec,
    ]).toEqual([
      { name: "control-plane.auth.send-verification-otp", version: "1" },
      { name: "control-plane.auth.send-organization-invitation", version: "1" },
      { name: "control-plane.sandbox-profiles.request-delete-profile", version: "1" },
      { name: "control-plane.sandbox-instances.start-profile-instance", version: "1" },
      { name: "control-plane.integration-webhooks.handle-event", version: "1" },
      { name: "control-plane.integration-connections.sync-resources", version: "1" },
      { name: "control-plane.automations.handle-run", version: "1" },
      { name: "control-plane.automation-conversations.handle-delivery", version: "1" },
    ]);
  });
});
