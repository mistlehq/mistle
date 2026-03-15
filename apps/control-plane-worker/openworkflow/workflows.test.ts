import {
  HandleAutomationConversationDeliveryWorkflowSpec,
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
  RequestDeleteSandboxProfileWorkflowSpec,
  SendOrganizationInvitationWorkflowSpec,
  SendVerificationOTPWorkflowSpec,
  StartSandboxProfileInstanceWorkflowSpec,
  SyncIntegrationConnectionResourcesWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { describe, expect, it } from "vitest";

import { HandleAutomationConversationDeliveryWorkflow } from "./handle-automation-conversation-delivery/workflow.js";
import { HandleAutomationRunWorkflow } from "./handle-automation-run.js";
import { HandleIntegrationWebhookEventWorkflow } from "./handle-integration-webhook-event.js";
import { RequestDeleteSandboxProfileWorkflow } from "./request-delete-sandbox-profile.js";
import { SendOrganizationInvitationWorkflow } from "./send-organization-invitation.js";
import { SendVerificationOTPWorkflow } from "./send-verification-otp.js";
import { StartSandboxProfileInstanceWorkflow } from "./start-sandbox-profile-instance.js";
import { SyncIntegrationConnectionResourcesWorkflow } from "./sync-integration-connection-resources.js";

describe("control-plane worker openworkflow entrypoints", () => {
  it("preserves the handle automation conversation delivery workflow identity", () => {
    expect(HandleAutomationConversationDeliveryWorkflow.spec).toMatchObject(
      HandleAutomationConversationDeliveryWorkflowSpec,
    );
  });

  it("preserves the handle automation run workflow identity", () => {
    expect(HandleAutomationRunWorkflow.spec).toMatchObject(HandleAutomationRunWorkflowSpec);
  });

  it("preserves the handle integration webhook event workflow identity", () => {
    expect(HandleIntegrationWebhookEventWorkflow.spec).toMatchObject(
      HandleIntegrationWebhookEventWorkflowSpec,
    );
  });

  it("preserves the request delete sandbox profile workflow identity", () => {
    expect(RequestDeleteSandboxProfileWorkflow.spec).toMatchObject(
      RequestDeleteSandboxProfileWorkflowSpec,
    );
  });

  it("preserves the send organization invitation workflow identity", () => {
    expect(SendOrganizationInvitationWorkflow.spec).toMatchObject(
      SendOrganizationInvitationWorkflowSpec,
    );
  });

  it("preserves the send verification OTP workflow identity", () => {
    expect(SendVerificationOTPWorkflow.spec).toMatchObject(SendVerificationOTPWorkflowSpec);
  });

  it("preserves the start sandbox profile instance workflow identity", () => {
    expect(StartSandboxProfileInstanceWorkflow.spec).toMatchObject(
      StartSandboxProfileInstanceWorkflowSpec,
    );
  });

  it("preserves the sync integration connection resources workflow identity", () => {
    expect(SyncIntegrationConnectionResourcesWorkflow.spec).toMatchObject(
      SyncIntegrationConnectionResourcesWorkflowSpec,
    );
  });
});
