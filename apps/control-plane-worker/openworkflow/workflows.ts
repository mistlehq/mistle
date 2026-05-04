import { HandleAutomationConversationDeliveryWorkflow } from "./handle-automation-conversation-delivery/workflow.js";
import { HandleAutomationRunWorkflow } from "./handle-automation-run/workflow.js";
import { HandleIntegrationWebhookEventWorkflow } from "./handle-integration-webhook-event/workflow.js";
import { RequestDeleteSandboxProfileWorkflow } from "./request-delete-sandbox-profile/workflow.js";
import { ScheduleDispatchBatchWorkflow } from "./schedule-dispatch/batch-workflow.js";
import { ScheduleDispatchWorkflow } from "./schedule-dispatch/workflow.js";
import { SendOrganizationInvitationWorkflow } from "./send-organization-invitation.js";
import { SendVerificationOTPWorkflow } from "./send-verification-otp.js";
import { StartSandboxProfileInstanceWorkflow } from "./start-sandbox-profile-instance/workflow.js";
import { SyncIntegrationConnectionResourcesWorkflow } from "./sync-integration-connection-resources/workflow.js";

/**
 * Explicit workflow manifest used by the test harness worker host.
 *
 * Production workers still start through the OpenWorkflow CLI config, which
 * performs directory discovery. The harness imports this manifest once per
 * Vitest worker process so logical test environments can start workers without
 * repeating CLI discovery and module loading for every environment.
 */
export const ControlPlaneWorkerWorkflows = [
  HandleAutomationConversationDeliveryWorkflow,
  HandleAutomationRunWorkflow,
  HandleIntegrationWebhookEventWorkflow,
  RequestDeleteSandboxProfileWorkflow,
  ScheduleDispatchBatchWorkflow,
  ScheduleDispatchWorkflow,
  SendOrganizationInvitationWorkflow,
  SendVerificationOTPWorkflow,
  StartSandboxProfileInstanceWorkflow,
  SyncIntegrationConnectionResourcesWorkflow,
];
