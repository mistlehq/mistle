import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import type { TriggerListItem } from "../triggers/triggers-types.js";
import {
  buildSandboxInstanceListItemFixture,
  buildStoryTriggerListItem,
  type SessionsPageStoryListFilters,
} from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type SessionsPageStoryArgs = {
  initialEntries: readonly string[];
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
  sandboxInstancesListFilters?: SessionsPageStoryListFilters;
  triggerOptions?: TriggerListItem[];
};

const meta = {
  title: "Dashboard/Sessions/Page",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    initialEntries: ["/sessions"],
    sandboxInstancesList: {
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_running",
          title: "Investigate flaky test run",
          sandboxProfileDisplayName: "Repo Maintainer",
          status: "running",
          updatedAt: "2026-04-01T09:00:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_starting",
          title:
            "Investigate why the billing reconciliation job stalls after sandbox reconnect and document the exact operator runbook for the next on-call handoff",
          sandboxProfileDisplayName: "Finance Investigator",
          status: "starting",
          updatedAt: "2026-04-01T08:55:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_stopped",
          title:
            "Compare the current sidebar truncation behavior with the sessions table so long conversation names stay compact but still reveal the full title on hover",
          sandboxProfileDisplayName: "Docs Maintainer",
          status: "stopped",
          updatedAt: "2026-03-31T15:30:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_failed",
          title: null,
          sandboxProfileDisplayName: "Webhook Debugger",
          status: "failed",
          updatedAt: "2026-03-31T12:00:00.000Z",
          failureCode: "sandbox_bootstrap_failed",
          failureMessage: "Could not start sandbox runtime because image pull failed.",
        }),
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 4,
    },
  },
  render: function RenderStory(args): React.JSX.Element {
    return (
      <SessionsStoryHarness
        initialEntries={args.initialEntries}
        {...(args.sandboxInstancesList !== undefined
          ? { sandboxInstancesList: args.sandboxInstancesList }
          : {})}
        {...(args.sandboxInstancesListFilters !== undefined
          ? { sandboxInstancesListFilters: args.sandboxInstancesListFilters }
          : {})}
        {...(args.launchableProfiles !== undefined
          ? { launchableProfiles: args.launchableProfiles }
          : {})}
        {...(args.triggerOptions !== undefined ? { triggerOptions: args.triggerOptions } : {})}
      />
    );
  },
} satisfies Meta<SessionsPageStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedStates: Story = {};

export const DeleteActionMenu: Story = {
  args: {
    sandboxInstancesList: {
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_delete_action_menu",
          title: "Clean up stale release session",
          sandboxProfileDisplayName: "Repo Maintainer",
          status: "running",
          updatedAt: "2026-04-01T09:00:00.000Z",
        }),
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Session actions for Clean up stale release session",
      }),
    );
  },
};

export const EmptyState: Story = {
  args: {
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const EmptyStateWithoutLaunchableProfiles: Story = {
  args: {
    launchableProfiles: [],
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const FilteredNoResults: Story = {
  args: {
    initialEntries: ["/sessions?search=PlanetScale&owner=me&startedFrom=trigger"],
    sandboxInstancesListFilters: {
      search: "PlanetScale",
      owner: "me",
      startedFrom: "trigger",
      triggerId: null,
    },
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const SpecificTriggerFilter: Story = {
  args: {
    initialEntries: ["/sessions?startedFrom=trigger&triggerId=atm_slack_mentions"],
    sandboxInstancesListFilters: {
      search: "",
      owner: "anyone",
      startedFrom: "trigger",
      triggerId: "atm_slack_mentions",
    },
    sandboxInstancesList: {
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_slack_mentions",
          title: "Slack app mention received",
          sandboxProfileDisplayName: "Mistlebot",
          startedBy: {
            kind: "system",
            id: "aru_slack_mentions",
            name: "Slack app mention received",
          },
          source: "webhook",
          updatedAt: "2026-04-01T09:00:00.000Z",
        }),
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    },
    triggerOptions: [
      buildStoryTriggerListItem({
        id: "atm_slack_mentions",
        name: "Slack app mention received",
      }),
      buildStoryTriggerListItem({
        id: "atm_nightly_cleanup",
        name: "Nightly cleanup",
        kind: "schedule",
        source: {
          kind: "schedule",
          cronExpression: "0 9 * * 1",
          timezone: "Asia/Singapore",
          nextScheduledAt: "2026-04-06T01:00:00.000Z",
        },
      }),
    ],
  },
};
