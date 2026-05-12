import { describe, expect, it } from "vitest";

import {
  AUTOMATIONS_QUERY_KEY_PREFIX,
  automationsListQueryKey,
  scheduledAutomationDetailQueryKey,
  webhookAutomationDetailQueryKey,
} from "./automations-query-keys.js";

describe("automations query keys", () => {
  it("builds the shared automations prefix", () => {
    expect(AUTOMATIONS_QUERY_KEY_PREFIX).toEqual(["automations"]);
  });

  it("builds the list query key", () => {
    expect(
      automationsListQueryKey({
        limit: 25,
        after: "cursor_after",
        before: null,
      }),
    ).toEqual(["automations", "list", 25, "cursor_after", null, undefined]);
    expect(
      automationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
        sandboxProfileId: "sbp_123",
      }),
    ).toEqual(["automations", "list", 25, null, null, "sbp_123"]);
  });

  it("builds the webhook detail query key", () => {
    expect(webhookAutomationDetailQueryKey("aut_123")).toEqual([
      "automations",
      "webhooks",
      "detail",
      "aut_123",
    ]);
  });

  it("builds the scheduled detail query key", () => {
    expect(scheduledAutomationDetailQueryKey("aut_456")).toEqual([
      "automations",
      "schedules",
      "detail",
      "aut_456",
    ]);
  });
});
