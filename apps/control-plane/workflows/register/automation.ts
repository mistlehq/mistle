import type { OpenWorkflow } from "openworkflow";

import { createHandleAutomationConversationDeliveryWorkflow } from "../handle-automation-conversation-delivery/index.js";
import { createHandleAutomationRunWorkflow } from "../handle-automation-run/index.js";
import type {
  ControlPlaneAutomationConversationDeliveryServices,
  ControlPlaneAutomationRunServices,
} from "../worker.js";

const HANDLE_AUTOMATION_RUN_WORKFLOW_ID = "handleAutomationRun";
const HANDLE_AUTOMATION_CONVERSATION_DELIVERY_WORKFLOW_ID = "handleAutomationConversationDelivery";

export type RegisterControlPlaneAutomationWorkflowsInput = {
  openWorkflow: OpenWorkflow;
  enabledWorkflows: ReadonlyArray<string>;
  services: {
    automationRuns?: ControlPlaneAutomationRunServices;
    automationConversationDelivery?: ControlPlaneAutomationConversationDeliveryServices;
  };
};

export function registerControlPlaneAutomationWorkflows(
  input: RegisterControlPlaneAutomationWorkflowsInput,
): void {
  if (input.enabledWorkflows.includes(HANDLE_AUTOMATION_RUN_WORKFLOW_ID)) {
    if (input.services.automationRuns === undefined) {
      throw new Error(
        "Control-plane automation runs service is required for handleAutomationRun workflow.",
      );
    }

    const workflow = createHandleAutomationRunWorkflow({
      transitionAutomationRunToRunning:
        input.services.automationRuns.transitionAutomationRunToRunning,
      prepareAutomationRun: input.services.automationRuns.prepareAutomationRun,
      handoffAutomationRunDelivery: input.services.automationRuns.handoffAutomationRunDelivery,
      markAutomationRunFailed: input.services.automationRuns.markAutomationRunFailed,
      resolveAutomationRunFailure: input.services.automationRuns.resolveAutomationRunFailure,
    });
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }

  if (input.enabledWorkflows.includes(HANDLE_AUTOMATION_CONVERSATION_DELIVERY_WORKFLOW_ID)) {
    if (input.services.automationConversationDelivery === undefined) {
      throw new Error(
        "Control-plane automation conversation delivery service is required for handleAutomationConversationDelivery workflow.",
      );
    }

    const workflow = createHandleAutomationConversationDeliveryWorkflow({
      claimOrResumeAutomationConversationDeliveryTask:
        input.services.automationConversationDelivery
          .claimOrResumeAutomationConversationDeliveryTask,
      resolveAutomationConversationDeliveryTaskAction:
        input.services.automationConversationDelivery
          .resolveAutomationConversationDeliveryTaskAction,
      idleAutomationConversationDeliveryProcessorIfEmpty:
        input.services.automationConversationDelivery
          .idleAutomationConversationDeliveryProcessorIfEmpty,
      prepareAutomationRun: input.services.automationConversationDelivery.prepareAutomationRun,
      resolveAutomationConversationDeliveryRoute:
        input.services.automationConversationDelivery.resolveAutomationConversationDeliveryRoute,
      ensureAutomationSandbox:
        input.services.automationConversationDelivery.ensureAutomationSandbox,
      acquireAutomationConnection:
        input.services.automationConversationDelivery.acquireAutomationConnection,
      deliverAutomationPayload:
        input.services.automationConversationDelivery.deliverAutomationPayload,
      markAutomationRunCompleted:
        input.services.automationConversationDelivery.markAutomationRunCompleted,
      markAutomationRunIgnored:
        input.services.automationConversationDelivery.markAutomationRunIgnored,
      markAutomationRunFailed:
        input.services.automationConversationDelivery.markAutomationRunFailed,
      finalizeAutomationConversationDeliveryTask:
        input.services.automationConversationDelivery.finalizeAutomationConversationDeliveryTask,
      resolveAutomationRunFailure:
        input.services.automationConversationDelivery.resolveAutomationRunFailure,
    });
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
