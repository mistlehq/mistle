import { describe, expect, it } from "vitest";

import {
  renderOpenCodePromptSystem,
  resolveOriginalOpenCodeSessionId,
} from "./conversation-provider.server.js";

describe("resolveOriginalOpenCodeSessionId", () => {
  it("selects the earliest session by created timestamp", () => {
    expect(
      resolveOriginalOpenCodeSessionId([
        { id: "session_recent", time: { created: 1_800 } },
        { id: "session_original", time: { created: 1_200 } },
        { id: "session_middle", time: { created: 1_500 } },
      ]),
    ).toBe("session_original");
  });

  it("breaks equal timestamp ties by stable session id ordering", () => {
    expect(
      resolveOriginalOpenCodeSessionId([
        { id: "session_b", time: { created: 1_200 } },
        { id: "session_a", time: { created: 1_200 } },
      ]),
    ).toBe("session_a");
  });
});

describe("renderOpenCodePromptSystem", () => {
  it("includes developer instructions and delivery context in the OpenCode system prompt", () => {
    expect(
      renderOpenCodePromptSystem({
        collaborationModeSettings: {
          developerInstructions: "Always include a reproducible next step.",
        },
        deliveryContextNotificationParams: {
          source: "webhook",
          webhookEventId: "evt_123",
          deliveryTaskId: "task_123",
          externalDeliveryId: "delivery_123",
          triggerRunId: "run_123",
          conversationId: "conversation_123",
          sandboxInstanceId: "sandbox_123",
          routeId: "route_123",
          customDeliveryField: "preserved",
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
          tracestate: "vendor=value",
          baggage: "organization_id=org_123",
        },
      }),
    ).toBe(`Always include a reproducible next step.

Mistle delivery context:
{
  "source": "webhook",
  "webhookEventId": "evt_123",
  "deliveryTaskId": "task_123",
  "externalDeliveryId": "delivery_123",
  "triggerRunId": "run_123",
  "conversationId": "conversation_123",
  "sandboxInstanceId": "sandbox_123",
  "routeId": "route_123",
  "customDeliveryField": "preserved",
  "traceparent": "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
  "tracestate": "vendor=value",
  "baggage": "organization_id=org_123"
}`);
  });

  it("omits the system prompt when no OpenCode prompt context is present", () => {
    expect(renderOpenCodePromptSystem({})).toBeUndefined();
    expect(
      renderOpenCodePromptSystem({
        collaborationModeSettings: {
          developerInstructions: null,
        },
      }),
    ).toBeUndefined();
  });
});
