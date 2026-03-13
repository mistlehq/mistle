import { describe, expect, it } from "vitest";

import {
  AUTOMATIONS_QUERY_KEY_PREFIX,
  webhookAutomationDetailQueryKey,
  webhookAutomationsListQueryKey,
} from "./webhook-automations-query-keys.js";

describe("webhook automations query keys", () => {
  it("builds the shared automations prefix", () => {
    expect(AUTOMATIONS_QUERY_KEY_PREFIX).toEqual(["automations"]);
  });

  it("builds the list query key", () => {
    expect(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: "cursor_after",
        before: null,
      }),
    ).toEqual(["automations", "webhooks", "list", 25, "cursor_after", null]);
  });

  it("builds the detail query key", () => {
    expect(webhookAutomationDetailQueryKey("aut_123")).toEqual([
      "automations",
      "webhooks",
      "detail",
      "aut_123",
    ]);
  });
});
