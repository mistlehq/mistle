// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TriggerListItemViewModel } from "./trigger-list-types.js";
import { TriggerListView } from "./trigger-list-view.js";

function noop(): void {}

const ScheduleTrigger: TriggerListItemViewModel = {
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

describe("TriggerListView", () => {
  it("places the GMT offset after the next scheduled time", () => {
    render(
      <TriggerListView
        errorMessage={null}
        hasNextPage={false}
        hasPreviousPage={false}
        items={[ScheduleTrigger]}
        onNextPage={noop}
        onOpenTrigger={noop}
        onPreviousPage={noop}
        totalResults={1}
      />,
    );

    expect(screen.getByText("27 10 * * *")).toBeDefined();
    expect(screen.getByText("Next May 4, 2026, 10:27 AM GMT+8")).toBeDefined();
  });
});
