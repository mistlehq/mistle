import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  SandboxInstancesListResult,
  SessionSidebarGroupsResult,
} from "../sessions/sessions-types.js";
import {
  buildSessionSidebarGroupFixture,
  buildSandboxInstanceListItemFixture,
  buildStoryLaunchableSandboxProfile,
} from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type SessionsSidebarStoryArgs = {
  initialEntries: readonly string[];
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sessionSidebarGroups?: SessionSidebarGroupsResult;
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

type SidebarStoryRecord = {
  id: string;
  profileId: string;
  profileName: string;
  title: string | null;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  createdAt: string;
  updatedAt: string;
  keepaliveActive: boolean;
};

function buildSessionSidebarGroupsFromRecords(
  records: readonly SidebarStoryRecord[],
): SessionSidebarGroupsResult {
  const groupsByProfileId = new Map<string, SessionSidebarGroupsResult["groups"][number]>();

  for (const record of records) {
    const existingGroup = groupsByProfileId.get(record.profileId);
    const group =
      existingGroup ??
      buildSessionSidebarGroupFixture({
        profileId: record.profileId,
        profileName: record.profileName,
      });

    group.items.push({
      id: record.id,
      title: record.title,
      status: record.status,
      updatedAt: record.updatedAt,
      keepaliveActive: record.keepaliveActive,
    });

    if (existingGroup === undefined) {
      groupsByProfileId.set(record.profileId, group);
    }
  }

  return {
    groups: [...groupsByProfileId.values()],
  };
}

function buildMixedOpenableSessionRecords(): SidebarStoryRecord[] {
  return [
    {
      id: "sbi_working_alpha",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title:
        "Investigate flaky test run after gateway lease handoff in the repo-maintainer sandbox",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:00:00.000Z",
      keepaliveActive: true,
    },
    {
      id: "sbi_recent_five_min",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title: "Review migration draft",
      status: "running",
      createdAt: "2026-04-08T08:50:00.000Z",
      updatedAt: "2026-04-08T08:55:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_recent_forty_five_min",
      profileId: "sbp_ops",
      profileName: "Ops Coordinator",
      title: "Prepare release notes",
      status: "running",
      createdAt: "2026-04-08T08:20:00.000Z",
      updatedAt: "2026-04-08T08:15:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_starting_docs",
      profileId: "sbp_docs",
      profileName: "Docs Maintainer",
      title:
        "Draft onboarding guide for new operators working across control plane and gateway runtime flows",
      status: "starting",
      createdAt: "2026-04-08T08:40:00.000Z",
      updatedAt: "2026-04-08T06:00:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_stopped_one_day",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: "Reconcile billing export",
      status: "stopped",
      createdAt: "2026-04-07T09:00:00.000Z",
      updatedAt: "2026-04-07T09:00:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_stopped_finance",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: null,
      status: "stopped",
      createdAt: "2026-04-08T07:30:00.000Z",
      updatedAt: "2026-04-06T07:30:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_stopped_four_day",
      profileId: "sbp_ops",
      profileName: "Ops Coordinator",
      title: "Audit webhook retry behavior",
      status: "stopped",
      createdAt: "2026-04-04T06:30:00.000Z",
      updatedAt: "2026-04-04T06:30:00.000Z",
      keepaliveActive: false,
    },
  ];
}

function buildMixedOpenableSessionsList(): SandboxInstancesListResult {
  return {
    items: buildMixedOpenableSessionRecords().map((record) =>
      buildSandboxInstanceListItemFixture({
        id: record.id,
        title: record.title,
        sandboxProfileId: record.profileId,
        sandboxProfileDisplayName: record.profileName,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        keepaliveActive: record.keepaliveActive,
      }),
    ),
    nextPage: null,
    previousPage: null,
    totalResults: 7,
  };
}

function buildMixedOpenableSessionSidebarGroups(): SessionSidebarGroupsResult {
  return buildSessionSidebarGroupsFromRecords(buildMixedOpenableSessionRecords());
}

function buildRecentlyUpdatedOrderingRecords(): SidebarStoryRecord[] {
  return [
    {
      id: "sbi_finance_newest",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: "Investigate failing payout reconciliation worker",
      status: "stopped",
      createdAt: "2026-04-10T08:00:00.000Z",
      updatedAt: "2026-04-20T11:45:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_finance_older_update",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: "Audit invoice export retries after webhook timeout",
      status: "stopped",
      createdAt: "2026-04-06T08:00:00.000Z",
      updatedAt: "2026-04-17T10:15:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_repo_newest",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title: "Fix flaky gateway lease handoff test",
      status: "running",
      createdAt: "2026-04-09T12:00:00.000Z",
      updatedAt: "2026-04-20T09:30:00.000Z",
      keepaliveActive: true,
    },
    {
      id: "sbi_repo_older_update",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title: "Trace Codex thread persistence in dashboard",
      status: "running",
      createdAt: "2026-04-08T09:30:00.000Z",
      updatedAt: "2026-04-18T16:00:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_ops_newest",
      profileId: "sbp_ops",
      profileName: "Ops Coordinator",
      title: "Validate release checklist after CI drift",
      status: "running",
      createdAt: "2026-04-11T07:30:00.000Z",
      updatedAt: "2026-04-19T14:00:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_docs_newest",
      profileId: "sbp_docs",
      profileName: "Docs Maintainer",
      title: "Draft setup guide for sandbox session recovery",
      status: "starting",
      createdAt: "2026-04-12T09:45:00.000Z",
      updatedAt: "2026-04-16T08:00:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_docs_oldest",
      profileId: "sbp_docs",
      profileName: "Docs Maintainer",
      title: "Tidy release note wording for session sidebar rollout",
      status: "stopped",
      createdAt: "2026-04-08T09:45:00.000Z",
      updatedAt: "2026-04-13T08:00:00.000Z",
      keepaliveActive: false,
    },
  ];
}

function buildRecentlyUpdatedOrderingGroups(): SessionSidebarGroupsResult {
  return buildSessionSidebarGroupsFromRecords(buildRecentlyUpdatedOrderingRecords());
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
    sessionSidebarGroups: buildMixedOpenableSessionSidebarGroups(),
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
        {...(args.sessionSidebarGroups !== undefined
          ? { sessionSidebarGroups: args.sessionSidebarGroups }
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
    sessionSidebarGroups: {
      groups: [],
    },
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const OrderedByMostRecentlyUpdated: Story = {
  args: {
    initialEntries: ["/sessions/new"],
    showSessionsSidebar: true,
    sessionSidebarGroups: buildRecentlyUpdatedOrderingGroups(),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shows the backend-provided sidebar grouping and recency order. Expected group order: Finance Investigator, Repo Maintainer, Ops Coordinator, Docs Maintainer.",
      },
    },
  },
};

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
