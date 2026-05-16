import { describe, expect, it } from "vitest";

import {
  TRIGGERS_QUERY_KEY_PREFIX,
  triggerDetailQueryKey,
  triggersListQueryKey,
  scheduledTriggerDetailQueryKey,
  webhookTriggerDetailQueryKey,
} from "./triggers-query-keys.js";

describe("triggers query keys", () => {
  it("builds the shared triggers prefix", () => {
    expect(TRIGGERS_QUERY_KEY_PREFIX).toEqual(["triggers"]);
  });

  it("builds the list query key", () => {
    expect(
      triggersListQueryKey({
        limit: 25,
        after: "cursor_after",
        before: null,
      }),
    ).toEqual(["triggers", "list", 25, "cursor_after", null, undefined]);
    expect(
      triggersListQueryKey({
        limit: 25,
        after: null,
        before: null,
        sandboxProfileId: "sbp_123",
      }),
    ).toEqual(["triggers", "list", 25, null, null, "sbp_123"]);
  });

  it("builds the trigger summary detail query key", () => {
    expect(triggerDetailQueryKey("atm_123")).toEqual(["triggers", "detail", "atm_123"]);
  });

  it("builds the webhook detail query key", () => {
    expect(webhookTriggerDetailQueryKey("aut_123")).toEqual([
      "triggers",
      "webhooks",
      "detail",
      "aut_123",
    ]);
  });

  it("builds the scheduled detail query key", () => {
    expect(scheduledTriggerDetailQueryKey("aut_456")).toEqual([
      "triggers",
      "schedules",
      "detail",
      "aut_456",
    ]);
  });
});
