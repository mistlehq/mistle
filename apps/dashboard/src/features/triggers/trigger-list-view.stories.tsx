import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { createTriggerListEvent, createTriggerListIssue } from "./trigger-list-test-fixtures.js";
import type { TriggerListItemViewModel } from "./trigger-list-types.js";
import { TriggerListView } from "./trigger-list-view.js";

const MixedItems: readonly TriggerListItemViewModel[] = [
  {
    id: "trg_01jps7k2z2v3qj4k9m0n1p2q3r",
    kind: "webhook",
    name: "GitHub pushes to repo triage",
    enabled: true,
    target: {
      sandboxProfileId: "sbp_repo_maintainer",
      sandboxProfileName: "Repo Maintainer",
      sandboxProfileVersion: 3,
      primaryRepositoryId: "mistlehq/platform",
      primaryRepositoryName: "mistlehq/platform",
    },
    source: {
      kind: "webhook",
      events: [
        createTriggerListEvent({
          label: "CI completed",
          logoKey: "github",
        }),
        createTriggerListEvent({
          label: "Pull request opened",
          logoKey: "github",
        }),
      ],
    },
    updatedAtLabel: "6 min ago",
  },
  {
    id: "trg_01jps7mhvgc0p7e01b4z4r7c0m",
    kind: "schedule",
    name: "Daily repository triage",
    enabled: true,
    target: {
      sandboxProfileId: "sbp_repo_maintainer",
      sandboxProfileName: "Repo Maintainer",
      sandboxProfileVersion: 3,
      primaryRepositoryId: "mistlehq/platform",
      primaryRepositoryName: "mistlehq/platform",
    },
    source: {
      kind: "schedule",
      cronExpression: "0 9 * * 1-5",
      timezone: "Asia/Singapore",
      nextScheduledAtLabel: "May 4, 2026, 9:00 AM",
      timezoneOffsetLabel: "GMT+8",
    },
    updatedAtLabel: "18 min ago",
  },
  {
    id: "trg_01jps7qxbxw6kxdj1r9s9v8y2h",
    kind: "schedule",
    name: "Weekly finance review",
    enabled: false,
    target: {
      sandboxProfileId: "sbp_finance_investigator",
      sandboxProfileName: "Finance Investigator",
      sandboxProfileVersion: 3,
      primaryRepositoryId: null,
      primaryRepositoryName: null,
    },
    source: {
      kind: "schedule",
      cronExpression: "0 8 * * MON",
      timezone: "America/New_York",
      nextScheduledAtLabel: null,
      timezoneOffsetLabel: "GMT-4",
    },
    updatedAtLabel: "1 day ago",
  },
  {
    id: "trg_01jps82rc4z62qy0m7zdb8h5qn",
    kind: "webhook",
    name: "Legacy GitHub escalation",
    enabled: true,
    target: {
      sandboxProfileId: "sbp_incident_commander",
      sandboxProfileName: "Incident Commander",
      sandboxProfileVersion: 3,
      primaryRepositoryId: "mistlehq/dashboard",
      primaryRepositoryName: "mistlehq/dashboard",
    },
    source: {
      kind: "webhook",
      events: [
        createTriggerListEvent({
          label: "github.push.deleted",
          unavailable: true,
        }),
      ],
    },
    updatedAtLabel: "3 days ago",
  },
];

const ScheduleOnlyItems = MixedItems.filter((item) => item.kind === "schedule");
const EventOnlyItems = MixedItems.filter((item) => item.kind === "webhook");

const RowLevelIssueItem: TriggerListItemViewModel = {
  id: "trg_01jps82rc4z62qy0m7zdb8h5qn",
  kind: "webhook",
  name: "Retired metadata triage",
  enabled: true,
  target: {
    sandboxProfileId: "sbp_incident_commander",
    sandboxProfileName: null,
    sandboxProfileVersion: 3,
    primaryRepositoryId: "mistlehq/legacy",
    primaryRepositoryName: "mistlehq/legacy",
  },
  source: {
    kind: "webhook",
    events: [
      createTriggerListEvent({
        label: "issue_comment.created",
        unavailable: true,
      }),
    ],
  },
  issue: createTriggerListIssue(),
  updatedAtLabel: "3 days ago",
};

const ScheduleWithoutNextRunItem: TriggerListItemViewModel = {
  id: "trg_01jps9mre5e9p0n6h7c2zmwr10",
  kind: "schedule",
  name: "Archived Monday report",
  enabled: true,
  target: {
    sandboxProfileId: "sbp_repo_maintainer",
    sandboxProfileName: "Repo Maintainer",
    sandboxProfileVersion: 3,
    primaryRepositoryId: null,
    primaryRepositoryName: null,
  },
  issue: createTriggerListIssue({
    code: "MISSING_TARGET_METADATA",
    message:
      "This scheduled trigger has no next run. Check whether the schedule is valid and enabled.",
  }),
  source: {
    kind: "schedule",
    cronExpression: "0 9 31 2 *",
    timezone: "Asia/Singapore",
    nextScheduledAtLabel: null,
    timezoneOffsetLabel: "GMT+8",
  },
  updatedAtLabel: "5 days ago",
};

const meta = {
  title: "Dashboard/Triggers/ListView",
  component: TriggerListView,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    activeFilter: "all",
    items: MixedItems,
    searchValue: "",
    errorMessage: null,
    totalResults: MixedItems.length,
    hasNextPage: false,
    hasPreviousPage: false,
    nextPageDisabled: false,
    previousPageDisabled: false,
    onNextPage: function onNextPage() {},
    onPreviousPage: function onPreviousPage() {},
    onFilterChange: function onFilterChange() {},
    onSearchValueChange: function onSearchValueChange() {},
    onOpenTrigger: function onOpenTrigger() {},
  },
} satisfies Meta<typeof TriggerListView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const EventOnly: Story = {
  args: {
    items: EventOnlyItems,
    totalResults: EventOnlyItems.length,
  },
};

export const ScheduleOnly: Story = {
  args: {
    items: ScheduleOnlyItems,
    totalResults: ScheduleOnlyItems.length,
  },
};

export const Paginated: Story = {
  args: {
    hasNextPage: true,
    hasPreviousPage: true,
    totalResults: 42,
  },
};

export const FilteredEmpty: Story = {
  args: {
    searchValue: "missing",
    items: [],
    totalResults: 0,
  },
};

export const ErrorState: Story = {
  args: {
    items: [],
    errorMessage: "The active organization could not be resolved for this request.",
    totalResults: null,
  },
};

export const RowLevelIssue: Story = {
  args: {
    items: [RowLevelIssueItem],
    totalResults: 1,
  },
};

export const ScheduleWithoutNextRun: Story = {
  args: {
    items: [ScheduleWithoutNextRunItem],
    totalResults: 1,
  },
};
