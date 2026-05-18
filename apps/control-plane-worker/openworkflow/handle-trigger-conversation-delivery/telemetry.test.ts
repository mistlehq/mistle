import { describe, expect, it } from "vitest";

import {
  createTriggerConversationDeliveryTelemetryAttributes,
  resolveTriggerConversationDeliveryTaskLifecycleEvent,
} from "./telemetry.js";

describe("createTriggerConversationDeliveryTelemetryAttributes", () => {
  it("maps known delivery identifiers into stable telemetry attribute keys", () => {
    expect(
      createTriggerConversationDeliveryTelemetryAttributes({
        triggerRunId: "aru_123",
        conversationId: "cnv_123",
        deliveryTaskId: "cdt_123",
        routeId: "cvr_123",
        sandboxInstanceId: "sbi_123",
        webhookEventId: "iwe_123",
        workflowRunId: "wfr_123",
      }),
    ).toEqual({
      "mistle.trigger.run_id": "aru_123",
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
      createTriggerConversationDeliveryTelemetryAttributes({
        triggerRunId: "aru_123",
        deliveryTaskId: "cdt_123",
      }),
    ).toEqual({
      "mistle.trigger.run_id": "aru_123",
      "mistle.delivery.task_id": "cdt_123",
    });
  });

  it("uses a distinct lifecycle event for resumed delivering tasks", () => {
    expect(
      resolveTriggerConversationDeliveryTaskLifecycleEvent({
        status: "delivering",
      }),
    ).toEqual({
      eventName: "delivery_task.resumed",
      message: "Resumed in-progress trigger conversation delivery task",
      attributes: {
        "mistle.delivery.task_resumed": true,
        "mistle.delivery.task_status": "delivering",
      },
    });
  });

  it("uses the claimed lifecycle event for newly claimed tasks", () => {
    expect(
      resolveTriggerConversationDeliveryTaskLifecycleEvent({
        status: "claimed",
      }),
    ).toEqual({
      eventName: "delivery_task.claimed",
      message: "Claimed trigger conversation delivery task",
      attributes: {
        "mistle.delivery.task_resumed": false,
        "mistle.delivery.task_status": "claimed",
      },
    });
  });
});
