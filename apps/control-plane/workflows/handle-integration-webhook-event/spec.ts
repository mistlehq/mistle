import { defineWorkflowSpec } from "openworkflow";

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
  name: "control-plane.integration-webhooks.handle-event",
  version: "1",
});
