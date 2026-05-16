import { describe, expect, it } from "vitest";

import {
  filterTriggerListItems,
  toTriggerListFilter,
  TRIGGER_LIST_FILTER_OPTIONS,
} from "./trigger-list-model.js";
import type { TriggerListItemViewModel } from "./trigger-list-types.js";

const EventTrigger: TriggerListItemViewModel = {
  id: "atm_event_123",
  kind: "webhook",
  name: "PR review",
  enabled: true,
  target: {
    sandboxProfileId: "sbp_repo_maintainer",
    sandboxProfileName: "Repo Maintainer",
    primaryRepositoryId: "mistlehq/platform",
    primaryRepositoryName: "mistlehq/platform",
  },
  source: {
    kind: "webhook",
    events: [
      {
        label: "Pull request opened",
        logoKey: "github",
      },
    ],
  },
  updatedAtLabel: "18 min ago",
};

const ScheduleTrigger: TriggerListItemViewModel = {
  id: "atm_schedule_123",
  kind: "schedule",
  name: "Daily triage",
  enabled: false,
  target: {
    sandboxProfileId: "sbp_repo_maintainer",
    sandboxProfileName: "Repo Maintainer",
    primaryRepositoryId: null,
    primaryRepositoryName: null,
  },
  source: {
    kind: "schedule",
    cronExpression: "0 9 * * 1-5",
    timezone: "Asia/Singapore",
    nextScheduledAtLabel: "May 4, 2026, 9:00 AM",
    timezoneOffsetLabel: "GMT+8",
  },
  updatedAtLabel: "1 day ago",
};

describe("trigger list model", () => {
  it("accepts every configured filter option", () => {
    for (const filterOption of TRIGGER_LIST_FILTER_OPTIONS) {
      expect(toTriggerListFilter(filterOption.value)).toBe(filterOption.value);
    }
  });

  it("filters triggers by source kind", () => {
    const items = [EventTrigger, ScheduleTrigger];

    expect(
      filterTriggerListItems({
        items,
        filter: "events",
        search: "",
      }).map((item) => item.id),
    ).toEqual(["atm_event_123"]);

    expect(
      filterTriggerListItems({
        items,
        filter: "schedules",
        search: "",
      }).map((item) => item.id),
    ).toEqual(["atm_schedule_123"]);
  });
});
