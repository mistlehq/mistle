import { expect, test } from "vitest";

import { HandleIntegrationWebhookEventWorkflow } from "./handle-integration-webhook-event.js";

test("HandleIntegrationWebhookEventWorkflow preserves the existing workflow identity", () => {
  expect(HandleIntegrationWebhookEventWorkflow.spec.name).toBe(
    "control-plane.integration-webhooks.handle-event",
  );
  expect(HandleIntegrationWebhookEventWorkflow.spec.version).toBe("1");
});
