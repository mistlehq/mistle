import { describe, expect, it } from "vitest";

import { buildEventSummaryTitle, resolveEventSummary } from "./automation-list-event-summary.js";
import { createAutomationListEvent } from "./automation-list-test-fixtures.js";

describe("buildEventSummaryTitle", () => {
  it("formats the tooltip copy for compact event summaries", () => {
    expect(
      buildEventSummaryTitle([
        createAutomationListEvent({
          label: "Pull request opened",
          logoKey: "github",
        }),
        createAutomationListEvent({
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
          createAutomationListEvent({
            label: "Pull request opened",
            logoKey: "github",
          }),
          createAutomationListEvent({
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
