// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AutomationListItemViewModel } from "./automation-list-types.js";
import { AutomationListView } from "./automation-list-view.js";

function noop(): void {}

const ScheduleAutomation: AutomationListItemViewModel = {
  id: "atm_schedule_123",
  kind: "schedule",
  name: "Daily repository triage",
  enabled: true,
  target: {
    sandboxProfileId: "sbp_repo_maintainer",
    sandboxProfileName: "Repo Maintainer",
    primaryRepositoryId: "mistlehq/platform",
    primaryRepositoryName: "mistlehq/platform",
  },
  source: {
    kind: "schedule",
    cronExpression: "27 10 * * *",
    timezone: "Asia/Singapore",
    nextScheduledAtLabel: "May 4, 2026, 10:27 AM",
    timezoneOffsetLabel: "GMT+8",
  },
  updatedAtLabel: "18 min ago",
};

describe("AutomationListView", () => {
  it("places the GMT offset after the next scheduled time", () => {
    render(
      <AutomationListView
        errorMessage={null}
        hasNextPage={false}
        hasPreviousPage={false}
        items={[ScheduleAutomation]}
        onNextPage={noop}
        onOpenAutomation={noop}
        onPreviousPage={noop}
        totalResults={1}
      />,
    );

    expect(screen.getByText("27 10 * * *")).toBeDefined();
    expect(screen.getByText("Next May 4, 2026, 10:27 AM GMT+8")).toBeDefined();
  });
});
