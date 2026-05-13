import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createMemoryRouter, Route, RouterProvider, createRoutesFromElements } from "react-router";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { scheduledAutomationDetailQueryKey } from "../automations/automations-query-keys.js";
import { automationsListQueryKey } from "../automations/automations-query-keys.js";
import type { AutomationsListResult } from "../automations/automations-types.js";
import type { ScheduledAutomation } from "../automations/scheduled-automations-types.js";
import { AUTOMATION_SANDBOX_PROFILES_QUERY_KEY } from "../automations/use-automation-sandbox-profile-options.js";
import {
  sandboxProfileVersionAutomationConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfileAutomationsSection } from "./sandbox-profile-automations-section.js";

const ProfileId = "sbp_repo_maintainer";
export const SelectedScheduleAutomationId = "atm_schedule_daily_triage";

const Profile: SandboxProfile = {
  id: ProfileId,
  organizationId: "org_story",
  displayName: "Repo Maintainer",
  activeVersion: 3,
  status: "active",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

export const ProfileAutomations: AutomationsListResult = {
  items: [
    {
      id: SelectedScheduleAutomationId,
      kind: "schedule",
      name: "Daily repository triage",
      enabled: true,
      target: {
        sandboxProfileId: ProfileId,
        sandboxProfileName: "Repo Maintainer",
        primaryRepositoryId: "mistlehq/platform",
        primaryRepositoryName: "mistlehq/platform",
      },
      source: {
        kind: "schedule",
        cronExpression: "0 9 * * 1-5",
        timezone: "Asia/Singapore",
        nextScheduledAt: "2026-05-12T01:00:00.000Z",
      },
      updatedAt: "2026-05-08T02:15:00.000Z",
    },
    {
      id: "atm_github_issue_triage",
      kind: "webhook",
      name: "GitHub issue triage",
      enabled: true,
      target: {
        sandboxProfileId: ProfileId,
        sandboxProfileName: "Repo Maintainer",
        primaryRepositoryId: "mistlehq/platform",
        primaryRepositoryName: "mistlehq/platform",
      },
      source: {
        kind: "webhook",
        events: [
          {
            label: "Issue comment created",
            logoKey: "github",
          },
          {
            label: "Pull request opened",
            logoKey: "github",
          },
        ],
      },
      updatedAt: "2026-05-08T01:25:00.000Z",
    },
    {
      id: "atm_legacy_webhook",
      kind: "webhook",
      name: "Legacy escalation",
      enabled: false,
      issue: {
        code: "MISSING_WEBHOOK_SOURCE",
        message:
          "This automation references a webhook source that is no longer available. Event metadata may be incomplete.",
      },
      target: {
        sandboxProfileId: ProfileId,
        sandboxProfileName: "Repo Maintainer",
        primaryRepositoryId: "mistlehq/legacy",
        primaryRepositoryName: "mistlehq/legacy",
      },
      source: {
        kind: "webhook",
        events: [
          {
            label: "github.push.deleted",
            unavailable: true,
          },
        ],
      },
      updatedAt: "2026-05-07T16:40:00.000Z",
    },
  ],
  nextPage: null,
  previousPage: null,
  totalResults: 3,
};

function createPaginatedProfileAutomationItem(input: {
  index: number;
  page: number;
}): AutomationsListResult["items"][number] {
  const index = input.index;
  const itemNumber = index + 1;
  if (index % 2 === 0) {
    return {
      id: `atm_schedule_page_${String(input.page)}_${String(itemNumber)}`,
      kind: "schedule",
      name: `Scheduled automation ${String(itemNumber)}`,
      enabled: true,
      target: {
        sandboxProfileId: ProfileId,
        sandboxProfileName: "Repo Maintainer",
        primaryRepositoryId: "mistlehq/platform",
        primaryRepositoryName: "mistlehq/platform",
      },
      source: {
        kind: "schedule",
        cronExpression: "0 9 * * 1-5",
        timezone: "Asia/Singapore",
        nextScheduledAt: "2026-05-12T01:00:00.000Z",
      },
      updatedAt: "2026-05-08T02:15:00.000Z",
    };
  }

  return {
    id: `atm_webhook_page_${String(input.page)}_${String(itemNumber)}`,
    kind: "webhook",
    name: `Webhook automation ${String(itemNumber)}`,
    enabled: itemNumber % 5 !== 0,
    target: {
      sandboxProfileId: ProfileId,
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
    updatedAt: "2026-05-08T01:25:00.000Z",
  };
}

const PaginatedProfileAutomations: AutomationsListResult = {
  items: Array.from({ length: 25 }, (_value, index) =>
    createPaginatedProfileAutomationItem({ index, page: 1 }),
  ),
  nextPage: {
    after: "cursor_page_2",
    limit: 25,
  },
  previousPage: null,
  totalResults: 42,
};

const PaginatedProfileAutomationsSecondPage: AutomationsListResult = {
  items: Array.from({ length: 17 }, (_value, index) =>
    createPaginatedProfileAutomationItem({ index: index + 25, page: 2 }),
  ),
  nextPage: null,
  previousPage: {
    before: "cursor_page_1",
    limit: 25,
  },
  totalResults: 42,
};

const SelectedScheduleAutomation: ScheduledAutomation = {
  id: SelectedScheduleAutomationId,
  kind: "schedule",
  name: "Daily repository triage",
  enabled: true,
  schedule: {
    id: "sch_daily_triage",
    name: "Weekday morning triage",
    cronExpression: "0 9 * * 1-5",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-05-12T01:00:00.000Z",
    lastScheduledAt: "2026-05-11T01:00:00.000Z",
  },
  inputTemplate: "Review new pull requests and summarize blockers.",
  conversationKeyTemplate: "{{schedule.id}}",
  idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
  target: {
    id: "atg_daily_triage",
    sandboxProfileId: ProfileId,
    sandboxProfileVersion: 3,
    primaryRepositoryId: "mistlehq/platform",
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-08T02:15:00.000Z",
};

type StoryAutomationPage = {
  after: string | null;
  automations: AutomationsListResult;
  before: string | null;
};

function createStoryQueryClient(input: {
  additionalPages?: readonly StoryAutomationPage[];
  automations: AutomationsListResult;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    automationsListQueryKey({
      limit: 25,
      after: null,
      before: null,
      sandboxProfileId: ProfileId,
    }),
    input.automations,
  );
  for (const page of input.additionalPages ?? []) {
    queryClient.setQueryData(
      automationsListQueryKey({
        limit: 25,
        after: page.after,
        before: page.before,
        sandboxProfileId: ProfileId,
      }),
      page.automations,
    );
  }
  queryClient.setQueryData(AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, [Profile]);
  queryClient.setQueryData(scheduledAutomationDetailQueryKey(SelectedScheduleAutomationId), {
    ...SelectedScheduleAutomation,
  });
  queryClient.setQueryData(sandboxProfileVersionsQueryKey(ProfileId), {
    versions: [
      {
        sandboxProfileId: ProfileId,
        version: 3,
        state: "published",
        isActive: true,
        publishedAt: "2026-05-01T00:00:00.000Z",
        defaultPersistenceMode: "ephemeral",
        sandboxProvider: null,
        sandboxConnectionId: null,
        sandboxVcpuCount: null,
        sandboxMemoryMb: null,
        sandboxStorageMb: null,
        snapshotImageProvider: null,
        snapshotImageId: null,
        latestSnapshotJob: null,
        refreshSchedule: null,
      },
    ],
  });
  queryClient.setQueryData(
    sandboxProfileVersionAutomationConfigQueryKey({
      profileId: ProfileId,
      version: 3,
    }),
    {
      repositoryOptions: [
        {
          id: "mistlehq/platform",
          name: "mistlehq/platform",
          path: "/workspaces/mistlehq/platform",
        },
      ],
      bindings: [],
    },
  );

  return queryClient;
}

export function SandboxProfileAutomationsStory(input: {
  additionalPages?: readonly StoryAutomationPage[];
  automations: AutomationsListResult;
  selectedAutomationId?: string;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      automations: input.automations,
      ...(input.additionalPages === undefined ? {} : { additionalPages: input.additionalPages }),
    }),
  );
  const initialPath =
    input.selectedAutomationId === undefined
      ? `/sandbox-profiles/${ProfileId}/automations`
      : `/sandbox-profiles/${ProfileId}/automations/${input.selectedAutomationId}`;
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<SandboxProfileAutomationsSection profileId={ProfileId} />}
          path="/sandbox-profiles/:profileId/automations"
        >
          <Route
            element={<SandboxProfileAutomationsSection profileId={ProfileId} />}
            path=":automationId"
          />
        </Route>,
      ),
      {
        initialEntries: [initialPath],
      },
    ),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Automations",
  component: SandboxProfileAutomationsStory,
  decorators: [withDashboardCenteredStory],
  excludeStories: [
    "ProfileAutomations",
    "SandboxProfileAutomationsStory",
    "SelectedScheduleAutomationId",
  ],
  args: {
    automations: ProfileAutomations,
  },
} satisfies Meta<typeof SandboxProfileAutomationsStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const MobilePaginated: Story = {
  args: {
    additionalPages: [
      {
        after: "cursor_page_2",
        automations: PaginatedProfileAutomationsSecondPage,
        before: null,
      },
    ],
    automations: PaginatedProfileAutomations,
  },
  render: function RenderMobilePaginated(args): React.JSX.Element {
    return (
      <div className="w-[375px]">
        <SandboxProfileAutomationsStory {...args} />
      </div>
    );
  },
};

export const SelectedScheduledAutomation: Story = {
  args: {
    selectedAutomationId: SelectedScheduleAutomationId,
  },
};

export const Empty: Story = {
  args: {
    automations: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};
