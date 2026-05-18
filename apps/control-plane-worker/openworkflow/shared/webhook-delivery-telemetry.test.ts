import { describe, expect, it } from "vitest";

import { createWebhookDeliveryTelemetryAttributes } from "./webhook-delivery-telemetry.js";

describe("webhook delivery telemetry", () => {
  it("creates attributes for webhook orchestration correlation", () => {
    expect(
      createWebhookDeliveryTelemetryAttributes({
        webhookEventId: "iwe_123",
        externalDeliveryId: "evt-delivery-123",
        triggerRunId: "aru_123",
        conversationId: "cnv_123",
        deliveryTaskId: "cdt_123",
        targetKey: "slack-staging",
        integrationConnectionId: "icn_123",
      }),
    ).toEqual({
      "mistle.trigger.run_id": "aru_123",
      "mistle.conversation.id": "cnv_123",
      "mistle.delivery.task_id": "cdt_123",
      "mistle.integration.connection_id": "icn_123",
      "mistle.integration.target_key": "slack-staging",
      "mistle.webhook.event_id": "iwe_123",
      "mistle.webhook.external_delivery_id": "evt-delivery-123",
    });
  });

  it("omits missing correlation fields", () => {
    expect(
      createWebhookDeliveryTelemetryAttributes({
        webhookEventId: "iwe_123",
      }),
    ).toEqual({
      "mistle.webhook.event_id": "iwe_123",
    });
  });
});
