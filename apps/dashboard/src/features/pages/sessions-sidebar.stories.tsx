import { systemScheduler, type TimerHandle } from "@mistle/time";
import { SidebarProvider } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { buildSessionsShellSidebarItems } from "../navigation/sessions-shell-sidebar.js";
import { SessionsSidebarNav } from "../navigation/sessions-sidebar-nav.js";
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

function buildSessionSidebarGroupsFromRecords(records: readonly SidebarStoryRecord[]) {
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

function buildSandboxInstancesListFromRecords(
  records: readonly SidebarStoryRecord[],
): SandboxInstancesListResult {
  return {
    items: records.map((record) =>
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
    totalResults: records.length,
  };
}

function buildSidebarStoryRecords(): SidebarStoryRecord[] {
  return [
    {
      id: "sbi_finance_newest",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: "Trace payout reconciliation worker after webhook retry storm",
      status: "stopped",
      createdAt: "2026-04-10T08:00:00.000Z",
      updatedAt: "2026-04-20T11:45:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_repo_newest",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title: "Stabilize gateway lease handoff integration run",
      status: "running",
      createdAt: "2026-04-09T12:00:00.000Z",
      updatedAt: "2026-04-20T10:50:00.000Z",
      keepaliveActive: true,
    },
    {
      id: "sbi_ops_newest",
      profileId: "sbp_ops",
      profileName: "Ops Coordinator",
      title: "Re-run release checklist after CI token rotation",
      status: "running",
      createdAt: "2026-04-11T07:30:00.000Z",
      updatedAt: "2026-04-20T10:05:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_finance_older_update",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: "Audit invoice export retries after webhook timeout",
      status: "stopped",
      createdAt: "2026-04-06T08:00:00.000Z",
      updatedAt: "2026-04-20T09:40:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_repo_older_update",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title: "Trace Codex thread persistence after reconnect",
      status: "running",
      createdAt: "2026-04-08T09:30:00.000Z",
      updatedAt: "2026-04-20T09:05:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_docs_newest",
      profileId: "sbp_docs",
      profileName: "Docs Maintainer",
      title: "Rewrite setup guide for session recovery handoff",
      status: "starting",
      createdAt: "2026-04-12T09:45:00.000Z",
      updatedAt: "2026-04-20T08:40:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_platform_recent",
      profileId: "sbp_platform",
      profileName: "Platform Debugger",
      title: "Verify restate worker startup after config reload",
      status: "running",
      createdAt: "2026-04-10T06:45:00.000Z",
      updatedAt: "2026-04-20T08:05:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_ops_older",
      profileId: "sbp_ops",
      profileName: "Ops Coordinator",
      title: "Check deploy freeze window before weekend release",
      status: "stopped",
      createdAt: "2026-04-09T07:30:00.000Z",
      updatedAt: "2026-04-20T07:10:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_repo_third",
      profileId: "sbp_repo_maintainer",
      profileName: "Repo Maintainer",
      title: "Review dashboard query invalidation after rename",
      status: "stopped",
      createdAt: "2026-04-06T09:30:00.000Z",
      updatedAt: "2026-04-20T06:55:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_docs_second",
      profileId: "sbp_docs",
      profileName: "Docs Maintainer",
      title: "Polish operator runbook for sandbox rebuild path",
      status: "stopped",
      createdAt: "2026-04-11T09:45:00.000Z",
      updatedAt: "2026-04-20T06:20:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_platform_second",
      profileId: "sbp_platform",
      profileName: "Platform Debugger",
      title: "Inspect control-plane retries after auth callback failure",
      status: "running",
      createdAt: "2026-04-08T06:45:00.000Z",
      updatedAt: "2026-04-20T05:50:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_finance_third",
      profileId: "sbp_finance",
      profileName: "Finance Investigator",
      title: "Compare ledger snapshots across billing backfill runs",
      status: "stopped",
      createdAt: "2026-04-05T08:00:00.000Z",
      updatedAt: "2026-04-20T05:10:00.000Z",
      keepaliveActive: false,
    },
    {
      id: "sbi_docs_oldest",
      profileId: "sbp_docs",
      profileName: "Docs Maintainer",
      title: "Tidy release note wording for sidebar rollout",
      status: "stopped",
      createdAt: "2026-04-08T09:45:00.000Z",
      updatedAt: "2026-04-20T04:30:00.000Z",
      keepaliveActive: false,
    },
  ];
}

function buildSidebarStoryGroups(): SessionSidebarGroupsResult {
  return buildSessionSidebarGroupsFromRecords(buildSidebarStoryRecords());
}

function buildSidebarStoryRecordsBatch(batchIndex: number): SidebarStoryRecord[] {
  return buildSidebarStoryRecords().map((record, recordIndex) => ({
    ...record,
    id: `${record.id}_batch_${String(batchIndex)}`,
    title:
      record.title === null
        ? null
        : `${record.title} · follow-up ${String(batchIndex + 1)}.${String(recordIndex + 1)}`,
    updatedAt: new Date(
      Date.parse(record.updatedAt) - (batchIndex * 90 + recordIndex) * 60_000,
    ).toISOString(),
  }));
}

function buildInteractiveSidebarStoryPage(pageIndex: number) {
  return buildSessionsShellSidebarItems(
    buildSessionSidebarGroupsFromRecords(buildSidebarStoryRecordsBatch(pageIndex)).groups,
    {
      nowEpochMs: Date.parse("2026-04-20T12:00:00.000Z"),
    },
  );
}

function buildSessionsSidebarStoryArgs(
  overrides?: Partial<SessionsSidebarStoryArgs>,
): SessionsSidebarStoryArgs {
  return {
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
    sessionSidebarGroups: buildSidebarStoryGroups(),
    sandboxInstancesList: buildSandboxInstancesListFromRecords(buildSidebarStoryRecords()),
    ...overrides,
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
  args: buildSessionsSidebarStoryArgs(),
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

export const Default: Story = {
  render: function RenderDefaultStory(): React.JSX.Element {
    return <InteractiveInfiniteScrollSidebarPreview />;
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shows the flat recent-session feed in its main interactive state. The sidebar is isolated in its own scroll container, sorted globally by updatedAt, and automatically appends older sessions when you reach the bottom.",
      },
    },
  },
};

function InteractiveInfiniteScrollSidebarPreview(): React.JSX.Element {
  const [visiblePageCount, setVisiblePageCount] = useState(1);
  const [statusBanner, setStatusBanner] = useState<
    | {
        kind: "loading";
        label: string;
      }
    | undefined
  >(undefined);
  const totalPageCount = 3;
  const hasMore = visiblePageCount < totalPageCount;
  const items = Array.from({ length: visiblePageCount }, (_, pageIndex) =>
    buildInteractiveSidebarStoryPage(pageIndex),
  ).flat();

  useEffect(() => {
    if (statusBanner?.kind !== "loading") {
      return;
    }

    const timeoutId: TimerHandle = systemScheduler.schedule(() => {
      if (hasMore) {
        setVisiblePageCount((currentCount) => currentCount + 1);
      }
      setStatusBanner(undefined);
    }, 800);

    return () => {
      systemScheduler.cancel(timeoutId);
    };
  }, [hasMore, statusBanner]);

  return (
    <SidebarProvider>
      <div className="h-screen bg-background">
        <div className="h-full w-56 overflow-y-auto border-r bg-sidebar py-3">
          <MemoryRouter initialEntries={["/sessions/new"]}>
            <SessionsSidebarNav
              items={items}
              infiniteScroll={{
                hasMore,
                onReachEnd: () => {
                  if (statusBanner !== undefined) {
                    return;
                  }

                  setStatusBanner({
                    kind: "loading",
                    label: "Loading more",
                  });
                },
                ...(statusBanner === undefined ? {} : { statusBanner }),
              }}
            />
          </MemoryRouter>
        </div>
      </div>
    </SidebarProvider>
  );
}

export const EmptyState: Story = {
  args: buildSessionsSidebarStoryArgs({
    sessionSidebarGroups: {
      groups: [],
    },
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  }),
};

export const LoadingState: Story = {
  args: buildSessionsSidebarStoryArgs({
    sessionsSidebarQueryState: {
      kind: "pending",
    },
  }),
};

export const LoadError: Story = {
  args: buildSessionsSidebarStoryArgs({
    sessionsSidebarQueryState: {
      kind: "error",
    },
  }),
};
