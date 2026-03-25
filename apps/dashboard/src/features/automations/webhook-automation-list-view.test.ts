import { describe, expect, it } from "vitest";

import { buildEventSummaryTitle, resolveEventSummary } from "./webhook-automation-list-view.js";
import { createWebhookAutomationListEvent } from "./webhook-automation-test-fixtures.js";

describe("buildEventSummaryTitle", () => {
  it("formats the tooltip copy for compact event summaries", () => {
    expect(
      buildEventSummaryTitle([
        createWebhookAutomationListEvent({
          label: "Pull request opened",
          logoKey: "github",
        }),
        createWebhookAutomationListEvent({
          label: "Issue comment created",
          unavailable: true,
        }),
      ]),
    ).toBe("Pull request opened, Issue comment created (Unavailable)");
  });
});

describe("resolveEventSummary", () => {
  it("returns the first event and remaining count", () => {
    expect(
      resolveEventSummary({
        events: [
          createWebhookAutomationListEvent({
            label: "Pull request opened",
            logoKey: "github",
          }),
          createWebhookAutomationListEvent({
            label: "Issue comment created",
            logoKey: "github",
          }),
        ],
      }),
    ).toEqual({
      firstEvent: {
        label: "Pull request opened",
        logoKey: "github",
      },
      remainingCount: 1,
      title: "Pull request opened, Issue comment created",
    });
  });

  it("handles empty event lists", () => {
    expect(
      resolveEventSummary({
        events: [],
      }),
    ).toEqual({
      firstEvent: null,
      remainingCount: 0,
      title: "",
    });
  });
});
