import { describe, expect, it } from "vitest";

import {
  createAutomationConversationDeliveryTelemetryAttributes,
  resolveAutomationConversationDeliveryTaskLifecycleEvent,
} from "./telemetry.js";

describe("createAutomationConversationDeliveryTelemetryAttributes", () => {
  it("maps known delivery identifiers into stable telemetry attribute keys", () => {
    expect(
      createAutomationConversationDeliveryTelemetryAttributes({
        automationRunId: "aru_123",
        conversationId: "cnv_123",
        deliveryTaskId: "cdt_123",
        routeId: "cvr_123",
        sandboxInstanceId: "sbi_123",
        webhookEventId: "iwe_123",
        workflowRunId: "wfr_123",
      }),
    ).toEqual({
      "mistle.automation.run_id": "aru_123",
      "mistle.conversation.id": "cnv_123",
      "mistle.delivery.task_id": "cdt_123",
      "mistle.route.id": "cvr_123",
      "mistle.sandbox.instance_id": "sbi_123",
      "mistle.webhook.event_id": "iwe_123",
      "mistle.workflow.run_id": "wfr_123",
    });
  });

  it("omits optional fields that are not present", () => {
    expect(
      createAutomationConversationDeliveryTelemetryAttributes({
        automationRunId: "aru_123",
        deliveryTaskId: "cdt_123",
      }),
    ).toEqual({
      "mistle.automation.run_id": "aru_123",
      "mistle.delivery.task_id": "cdt_123",
    });
  });

  it("uses a distinct lifecycle event for resumed delivering tasks", () => {
    expect(
      resolveAutomationConversationDeliveryTaskLifecycleEvent({
        status: "delivering",
      }),
    ).toEqual({
      eventName: "delivery_task.resumed",
      message: "Resumed in-progress automation conversation delivery task",
      attributes: {
        "mistle.delivery.task_resumed": true,
        "mistle.delivery.task_status": "delivering",
      },
    });
  });

  it("uses the claimed lifecycle event for newly claimed tasks", () => {
    expect(
      resolveAutomationConversationDeliveryTaskLifecycleEvent({
        status: "claimed",
      }),
    ).toEqual({
      eventName: "delivery_task.claimed",
      message: "Claimed automation conversation delivery task",
      attributes: {
        "mistle.delivery.task_resumed": false,
        "mistle.delivery.task_status": "claimed",
      },
    });
  });
});
