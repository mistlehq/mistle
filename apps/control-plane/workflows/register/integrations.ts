import type { OpenWorkflow } from "openworkflow";

import { createHandleIntegrationWebhookEventWorkflow } from "../handle-integration-webhook-event/index.js";
import { createSyncIntegrationConnectionResourcesWorkflow } from "../sync-integration-connection-resources/index.js";
import type {
  ControlPlaneIntegrationConnectionResourceServices,
  ControlPlaneIntegrationWebhookServices,
} from "../worker.js";

const HANDLE_INTEGRATION_WEBHOOK_EVENT_WORKFLOW_ID = "handleIntegrationWebhookEvent";
const SYNC_INTEGRATION_CONNECTION_RESOURCES_WORKFLOW_ID = "syncIntegrationConnectionResources";

export type RegisterControlPlaneIntegrationWorkflowsInput = {
  openWorkflow: OpenWorkflow;
  enabledWorkflows: ReadonlyArray<string>;
  services: {
    integrationWebhooks?: ControlPlaneIntegrationWebhookServices;
    integrationConnectionResources?: ControlPlaneIntegrationConnectionResourceServices;
  };
};

export function registerControlPlaneIntegrationWorkflows(
  input: RegisterControlPlaneIntegrationWorkflowsInput,
): void {
  if (input.enabledWorkflows.includes(HANDLE_INTEGRATION_WEBHOOK_EVENT_WORKFLOW_ID)) {
    if (input.services.integrationWebhooks === undefined) {
      throw new Error(
        "Control-plane integration webhooks service is required for handleIntegrationWebhookEvent workflow.",
      );
    }

    const workflow = createHandleIntegrationWebhookEventWorkflow({
      handleWebhookEvent: input.services.integrationWebhooks.handleWebhookEvent,
    });
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }

  if (input.enabledWorkflows.includes(SYNC_INTEGRATION_CONNECTION_RESOURCES_WORKFLOW_ID)) {
    if (input.services.integrationConnectionResources === undefined) {
      throw new Error(
        "Control-plane integration connection resources service is required for syncIntegrationConnectionResources workflow.",
      );
    }

    const workflow = createSyncIntegrationConnectionResourcesWorkflow({
      syncIntegrationConnectionResources:
        input.services.integrationConnectionResources.syncIntegrationConnectionResources,
    });
    input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
  }
}
