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
      BEGIN_PAYLOAD_DELIVERY: "begin-automation-payload-delivery",
      LOAD_OR_CREATE_ROUTE: "load-or-create-automation-conversation-route",
      CREATE_PROVIDER_CONVERSATION: "create-automation-provider-conversation",
      INSPECT_RESUME_PROVIDER_CONVERSATION: "inspect-resume-automation-provider-conversation",
      SUBMIT_PROVIDER_PAYLOAD: "submit-automation-provider-payload",
      PERSIST_PROVIDER_DELIVERY: "persist-automation-provider-delivery",
      SEED_SANDBOX_TITLE: "seed-automation-sandbox-title",
      MARK_RUN_COMPLETED: "mark-automation-run-completed",
      MARK_RUN_FAILED: "mark-automation-run-failed",
    });
  });
});
