// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { buildEventSummaryTitle, resolveEventSummary } from "./webhook-automation-list-view.js";
import { WebhookAutomationListView } from "./webhook-automation-list-view.js";
import { createWebhookAutomationListItemViewModel } from "./webhook-automation-test-fixtures.js";
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

describe("WebhookAutomationListView", () => {
  it("shows row-level issue messages for affected automations", () => {
    render(
      createElement(WebhookAutomationListView, {
        errorMessage: null,
        hasNextPage: false,
        hasPreviousPage: false,
        isLoading: false,
        items: [
          createWebhookAutomationListItemViewModel({
            issue: {
              code: "MISSING_TARGET_METADATA",
              message:
                "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
            },
          }),
        ],
        onNextPage: () => {},
        onOpenAutomation: () => {},
        onPreviousPage: () => {},
        onRetry: () => {},
        totalResults: 1,
      }),
    );

    expect(
      screen.getByText(
        "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
      ),
    ).toBeDefined();
  });
});
