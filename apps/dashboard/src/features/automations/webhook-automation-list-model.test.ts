import { describe, expect, it } from "vitest";

import {
  filterWebhookAutomationListItems,
  formatWebhookAutomationListFilter,
  toWebhookAutomationListFilter,
} from "./webhook-automation-list-model.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-types.js";

const SampleItems: readonly WebhookAutomationListItemViewModel[] = [
  {
    id: "aut_01",
    name: "GitHub pushes to repo triage",
    targetName: "Repo Maintainer",
    events: [
      {
        label: "Pull request opened",
        logoKey: "github",
      },
      {
        label: "Issue comment created",
        logoKey: "github",
      },
    ],
    updatedAtLabel: "6 min ago",
    enabled: true,
  },
  {
    id: "aut_02",
    name: "Stripe payouts incident intake",
    targetName: "Finance Investigator",
    events: [
      {
        label: "Payout failed",
      },
    ],
    updatedAtLabel: "1 day ago",
    enabled: false,
  },
];

describe("formatWebhookAutomationListFilter", () => {
  it("returns the display label for a filter", () => {
    expect(formatWebhookAutomationListFilter("enabled")).toBe("Enabled");
  });
});

describe("toWebhookAutomationListFilter", () => {
  it("accepts supported filter values", () => {
    expect(toWebhookAutomationListFilter("all")).toBe("all");
    expect(toWebhookAutomationListFilter("enabled")).toBe("enabled");
    expect(toWebhookAutomationListFilter("disabled")).toBe("disabled");
  });

  it("throws for unsupported filter values", () => {
    expect(() => {
      toWebhookAutomationListFilter("archived");
    }).toThrow('Unexpected webhook automation filter value: "archived".');
  });
});

describe("filterWebhookAutomationListItems", () => {
  it("returns all items when the filter is all and search is empty", () => {
    expect(
      filterWebhookAutomationListItems({
        items: SampleItems,
        filter: "all",
        search: "",
      }),
    ).toEqual(SampleItems);
  });

  it("filters to enabled and disabled items", () => {
    expect(
      filterWebhookAutomationListItems({
        items: SampleItems,
        filter: "enabled",
        search: "",
      }),
    ).toEqual([SampleItems[0]]);

    expect(
      filterWebhookAutomationListItems({
        items: SampleItems,
        filter: "disabled",
        search: "",
      }),
    ).toEqual([SampleItems[1]]);
  });

  it("matches search across list columns", () => {
    expect(
      filterWebhookAutomationListItems({
        items: SampleItems,
        filter: "all",
        search: "finance",
      }),
    ).toEqual([SampleItems[1]]);

    expect(
      filterWebhookAutomationListItems({
        items: SampleItems,
        filter: "all",
        search: "disabled",
      }),
    ).toEqual([SampleItems[1]]);
  });
});
