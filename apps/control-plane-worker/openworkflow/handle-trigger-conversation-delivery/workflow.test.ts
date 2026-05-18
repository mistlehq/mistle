import { describe, expect, test } from "vitest";

import { DurableTriggerConversationDeliveryStepPrefixes } from "./workflow.js";

describe("trigger conversation delivery workflow", () => {
  test("keeps durable v1 side-effect step prefixes stable", () => {
    expect(DurableTriggerConversationDeliveryStepPrefixes).toEqual({
      MARK_RUN_IGNORED: "mark-automation-run-ignored",
      PREPARE_RUN: "prepare-automation-run",
      RESOLVE_ROUTE: "resolve-automation-conversation-delivery-route",
      ENSURE_SANDBOX: "ensure-automation-sandbox",
      ACQUIRE_CONNECTION: "acquire-automation-connection",
      DELIVER_PAYLOAD: "deliver-automation-payload",
      MARK_RUN_COMPLETED: "mark-automation-run-completed",
      MARK_RUN_FAILED: "mark-automation-run-failed",
    });
  });
});
