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
    ).toEqual([
      "triggers",
      "list",
      {
        limit: 25,
        after: "cursor_after",
        before: null,
      },
    ]);
    expect(
      triggersListQueryKey({
        limit: 25,
        after: null,
        before: null,
        sandboxProfileId: "sbp_123",
        kind: "schedule",
        enabled: false,
        search: "daily",
      }),
    ).toEqual([
      "triggers",
      "list",
      {
        limit: 25,
        after: null,
        before: null,
        sandboxProfileId: "sbp_123",
        kind: "schedule",
        enabled: false,
        search: "daily",
      },
    ]);
  });

  it("builds the trigger summary detail query key", () => {
    expect(triggerDetailQueryKey("trg_123")).toEqual(["triggers", "detail", "trg_123"]);
  });

  it("builds the webhook detail query key", () => {
    expect(webhookTriggerDetailQueryKey("trg_123")).toEqual([
      "triggers",
      "webhooks",
      "detail",
      "trg_123",
    ]);
  });

  it("builds the scheduled detail query key", () => {
    expect(scheduledTriggerDetailQueryKey("trg_456")).toEqual([
      "triggers",
      "schedules",
      "detail",
      "trg_456",
    ]);
  });
});
