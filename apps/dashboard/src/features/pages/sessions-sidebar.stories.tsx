import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import {
  buildSandboxInstanceListItemFixture,
  buildStoryLaunchableSandboxProfile,
} from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type SessionsSidebarStoryArgs = {
  initialEntries: readonly string[];
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
  sessionsSidebarQueryState?:
    | {
        kind: "success";
      }
    | {
        kind: "pending";
      }
    | {
        errorMessage?: string;
        kind: "error";
      };
  showSessionsSidebar?: boolean;
};

function buildMixedOpenableSessionsList(): SandboxInstancesListResult {
  return {
    items: [
      buildSandboxInstanceListItemFixture({
        id: "sbi_working_alpha",
        title:
          "Investigate flaky test run after gateway lease handoff in the repo-maintainer sandbox",
        sandboxProfileId: "sbp_repo_maintainer",
        sandboxProfileDisplayName: "Repo Maintainer",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:00.000Z",
        keepaliveActive: true,
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_recent_five_min",
        title: "Review migration draft",
        sandboxProfileId: "sbp_repo_maintainer",
        sandboxProfileDisplayName: "Repo Maintainer",
        status: "running",
        createdAt: "2026-04-08T08:50:00.000Z",
        updatedAt: "2026-04-08T08:55:00.000Z",
        keepaliveActive: false,
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_recent_forty_five_min",
        title: "Prepare release notes",
        sandboxProfileId: "sbp_ops",
        sandboxProfileDisplayName: "Ops Coordinator",
        status: "running",
        createdAt: "2026-04-08T08:20:00.000Z",
        updatedAt: "2026-04-08T08:15:00.000Z",
        keepaliveActive: false,
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_starting_docs",
        title:
          "Draft onboarding guide for new operators working across control plane and gateway runtime flows",
        sandboxProfileId: "sbp_docs",
        sandboxProfileDisplayName: "Docs Maintainer",
        status: "starting",
        createdAt: "2026-04-08T08:40:00.000Z",
        updatedAt: "2026-04-08T06:00:00.000Z",
        keepaliveActive: false,
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_stopped_one_day",
        title: "Reconcile billing export",
        sandboxProfileId: "sbp_finance",
        sandboxProfileDisplayName: "Finance Investigator",
        status: "stopped",
        createdAt: "2026-04-07T09:00:00.000Z",
        updatedAt: "2026-04-07T09:00:00.000Z",
        keepaliveActive: false,
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_stopped_finance",
        title: null,
        sandboxProfileId: "sbp_finance",
        sandboxProfileDisplayName: "Finance Investigator",
        status: "stopped",
        createdAt: "2026-04-08T07:30:00.000Z",
        updatedAt: "2026-04-06T07:30:00.000Z",
        keepaliveActive: false,
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_stopped_four_day",
        title: "Audit webhook retry behavior",
        sandboxProfileId: "sbp_ops",
        sandboxProfileDisplayName: "Ops Coordinator",
        status: "stopped",
        createdAt: "2026-04-04T06:30:00.000Z",
        updatedAt: "2026-04-04T06:30:00.000Z",
        keepaliveActive: false,
      }),
    ],
    nextPage: null,
    previousPage: null,
    totalResults: 7,
  };
}

const meta = {
  title: "Dashboard/Sessions/Sidebar",
  component: SessionsStoryHarness,
  tags: ["autodocs"],
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    initialEntries: ["/sessions/new"],
    showSessionsSidebar: true,
    launchableProfiles: [
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_alpha",
        displayName: "Alpha Profile",
      }),
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_beta",
        displayName: "Beta Profile",
        latestVersion: 7,
      }),
    ],
    sandboxInstancesList: buildMixedOpenableSessionsList(),
  },
  render: function RenderStory(args): React.JSX.Element {
    return (
      <SessionsStoryHarness
        initialEntries={args.initialEntries}
        {...(args.launchableProfiles !== undefined
          ? { launchableProfiles: args.launchableProfiles }
          : {})}
        {...(args.sandboxInstancesList !== undefined
          ? { sandboxInstancesList: args.sandboxInstancesList }
          : {})}
        {...(args.sessionsSidebarQueryState !== undefined
          ? { sessionsSidebarQueryState: args.sessionsSidebarQueryState }
          : {})}
        {...(args.showSessionsSidebar !== undefined
          ? { showSessionsSidebar: args.showSessionsSidebar }
          : {})}
      />
    );
  },
} satisfies Meta<SessionsSidebarStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyState: Story = {
  args: {
    initialEntries: ["/sessions/new"],
    showSessionsSidebar: true,
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const NoLaunchableProfiles: Story = {
  args: {
    initialEntries: ["/sessions/new"],
    showSessionsSidebar: true,
    launchableProfiles: [],
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const ActivityIndicatorOnly: Story = {};

export const LoadingState: Story = {
  args: {
    initialEntries: ["/sessions/new"],
    sessionsSidebarQueryState: {
      kind: "pending",
    },
    showSessionsSidebar: true,
  },
};

export const LoadError: Story = {
  args: {
    initialEntries: ["/sessions/new"],
    sessionsSidebarQueryState: {
      kind: "error",
    },
    showSessionsSidebar: true,
  },
};

export const SessionSelected: Story = {
  args: {
    initialEntries: ["/sessions/sbi_working_alpha"],
    showSessionsSidebar: true,
  },
};

export const ToggleRoundTripFromAutomations: Story = {
  args: {
    initialEntries: ["/automations"],
    showSessionsSidebar: false,
  },
};
