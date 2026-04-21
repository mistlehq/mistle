import { describe, expect, it } from "vitest";

import { createIntegrationWebhookTelemetryAttributes } from "./telemetry.js";

describe("integration webhook telemetry", () => {
  it("includes only defined correlation attributes", () => {
    expect(
      createIntegrationWebhookTelemetryAttributes({
        webhookEventId: "iwe_123",
        externalDeliveryId: "evt-delivery-123",
        integrationConnectionId: "icn_123",
        targetKey: "slack-staging",
        endpointKey: "epk_123",
      }),
    ).toEqual({
      "mistle.integration.connection_id": "icn_123",
      "mistle.integration.target_key": "slack-staging",
      "mistle.webhook.endpoint_key": "epk_123",
      "mistle.webhook.event_id": "iwe_123",
      "mistle.webhook.external_delivery_id": "evt-delivery-123",
    });
  });

  it("omits undefined attributes", () => {
    expect(
      createIntegrationWebhookTelemetryAttributes({
        targetKey: "github-cloud",
      }),
    ).toEqual({
      "mistle.integration.target_key": "github-cloud",
    });
  });
});
