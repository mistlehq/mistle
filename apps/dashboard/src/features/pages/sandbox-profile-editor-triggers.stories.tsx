import { SlackBrowserDefinition } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createMemoryRouter, Route, RouterProvider, createRoutesFromElements } from "react-router";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { createStoryWebhookTriggerCapabilitiesProviderMetadata } from "../integrations/integration-story-harness.js";
import {
  sandboxProfileVersionTriggerConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { ScheduledTrigger } from "../triggers/scheduled-triggers-types.js";
import { scheduledTriggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggersListResult } from "../triggers/triggers-types.js";
import { TRIGGER_SANDBOX_PROFILES_QUERY_KEY } from "../triggers/use-trigger-sandbox-profile-options.js";
import {
  WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
} from "../triggers/use-webhook-trigger-prerequisites.js";
import { SandboxProfileTriggersSection } from "./sandbox-profile-triggers-section.js";

const ProfileId = "sbp_repo_maintainer";
const SlackConnectionId = "icn_slack_story";
const SlackWebhookSourceId = "iws_slack_story";
export const SelectedScheduleTriggerId = "atm_schedule_daily_triage";

const Profile: SandboxProfile = {
  id: ProfileId,
  organizationId: "org_story",
  displayName: "Repo Maintainer",
  activeVersion: 3,
  status: "active",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

export const ProfileTriggers: TriggersListResult = {
  items: [
    {
      id: SelectedScheduleTriggerId,
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
          "This trigger references a webhook source that is no longer available. Event metadata may be incomplete.",
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

function createPaginatedProfileTriggerItem(input: {
  index: number;
  page: number;
}): TriggersListResult["items"][number] {
  const index = input.index;
  const itemNumber = index + 1;
  if (index % 2 === 0) {
    return {
      id: `atm_schedule_page_${String(input.page)}_${String(itemNumber)}`,
      kind: "schedule",
      name: `Scheduled trigger ${String(itemNumber)}`,
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
    name: `Webhook trigger ${String(itemNumber)}`,
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

const PaginatedProfileTriggers: TriggersListResult = {
  items: Array.from({ length: 25 }, (_value, index) =>
    createPaginatedProfileTriggerItem({ index, page: 1 }),
  ),
  nextPage: {
    after: "cursor_page_2",
    limit: 25,
  },
  previousPage: null,
  totalResults: 42,
};

const PaginatedProfileTriggersSecondPage: TriggersListResult = {
  items: Array.from({ length: 17 }, (_value, index) =>
    createPaginatedProfileTriggerItem({ index: index + 25, page: 2 }),
  ),
  nextPage: null,
  previousPage: {
    before: "cursor_page_1",
    limit: 25,
  },
  totalResults: 42,
};

const SelectedScheduleTrigger: ScheduledTrigger = {
  id: SelectedScheduleTriggerId,
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

type StoryTriggerPage = {
  after: string | null;
  triggers: TriggersListResult;
  before: string | null;
};

function createStoryQueryClient(input: {
  additionalPages?: readonly StoryTriggerPage[];
  triggers: TriggersListResult;
  slackConnectionAvailable?: boolean;
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
    triggersListQueryKey({
      limit: 25,
      after: null,
      before: null,
      sandboxProfileId: ProfileId,
    }),
    input.triggers,
  );
  for (const page of input.additionalPages ?? []) {
    queryClient.setQueryData(
      triggersListQueryKey({
        limit: 25,
        after: page.after,
        before: page.before,
        sandboxProfileId: ProfileId,
      }),
      page.triggers,
    );
  }
  queryClient.setQueryData(TRIGGER_SANDBOX_PROFILES_QUERY_KEY, [Profile]);
  queryClient.setQueryData(scheduledTriggerDetailQueryKey(SelectedScheduleTriggerId), {
    ...SelectedScheduleTrigger,
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
    sandboxProfileVersionTriggerConfigQueryKey({
      profileId: ProfileId,
      version: 3,
    }),
    {
      repositoryOptions: [
        {
          id: "mistlehq/platform",
          label: "mistlehq/platform",
          path: "/workspaces/mistlehq/platform",
        },
      ],
      bindings:
        input.slackConnectionAvailable === false
          ? []
          : [
              {
                id: "bnd_slack_story",
                sandboxProfileId: ProfileId,
                sandboxProfileVersion: 3,
                connectionId: SlackConnectionId,
                kind: "connector",
                config: {},
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-08T00:00:00.000Z",
              },
            ],
    },
  );
  queryClient.setQueryData(WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY, {
    connections:
      input.slackConnectionAvailable === false
        ? []
        : [
            {
              id: SlackConnectionId,
              targetKey: "slack-default",
              displayName: "Slack Engineering",
              status: "active",
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-08T00:00:00.000Z",
            },
          ],
    targets: [
      {
        targetKey: "slack-default",
        familyId: SlackBrowserDefinition.familyId,
        variantId: SlackBrowserDefinition.variantId,
        kind: SlackBrowserDefinition.kind,
        enabled: true,
        config: {},
        displayName: SlackBrowserDefinition.displayName,
        description: "Slack workspace",
        ...(SlackBrowserDefinition.logoKey === undefined
          ? {}
          : { logoKey: SlackBrowserDefinition.logoKey }),
        supportedWebhookEvents: SlackBrowserDefinition.supportedWebhookEvents,
        targetHealth: {
          configStatus: "valid",
        },
      },
    ],
  });
  if (input.slackConnectionAvailable !== false) {
    queryClient.setQueryData(
      [...WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, SlackConnectionId],
      [
        {
          id: SlackWebhookSourceId,
          targetKey: "slack-default",
          integrationConnectionId: SlackConnectionId,
          displayName: "Slack Events API webhook",
          endpointKey: "ep_slack_story",
          status: "active",
          providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
            definition: SlackBrowserDefinition,
            events: ["app_mention"],
            permissions: [{ permission: "app_mentions:read" }],
          }),
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    );
  }

  return queryClient;
}

export function SandboxProfileTriggersStory(input: {
  additionalPages?: readonly StoryTriggerPage[];
  triggers: TriggersListResult;
  selectedTriggerId?: string;
  slackConnectionAvailable?: boolean;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      triggers: input.triggers,
      ...(input.additionalPages === undefined ? {} : { additionalPages: input.additionalPages }),
      ...(input.slackConnectionAvailable === undefined
        ? {}
        : { slackConnectionAvailable: input.slackConnectionAvailable }),
    }),
  );
  const initialPath =
    input.selectedTriggerId === undefined
      ? `/sandbox-profiles/${ProfileId}/triggers`
      : `/sandbox-profiles/${ProfileId}/triggers/${input.selectedTriggerId}`;
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<SandboxProfileTriggersSection profileId={ProfileId} />}
          path="/sandbox-profiles/:profileId/triggers"
        >
          <Route
            element={<SandboxProfileTriggersSection profileId={ProfileId} />}
            path=":triggerId"
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
  title: "Dashboard/SandboxProfiles/Editor/Triggers",
  component: SandboxProfileTriggersStory,
  decorators: [withDashboardCenteredStory],
  excludeStories: ["ProfileTriggers", "SandboxProfileTriggersStory", "SelectedScheduleTriggerId"],
  args: {
    triggers: ProfileTriggers,
  },
} satisfies Meta<typeof SandboxProfileTriggersStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const TemplatePickerWithExistingTriggers: Story = {};

export const TemplatePickerEmpty: Story = {
  args: {
    triggers: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};

export const TemplatePickerUnavailable: Story = {
  args: {
    triggers: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
    slackConnectionAvailable: false,
  },
};

export const MobilePaginated: Story = {
  args: {
    additionalPages: [
      {
        after: "cursor_page_2",
        triggers: PaginatedProfileTriggersSecondPage,
        before: null,
      },
    ],
    triggers: PaginatedProfileTriggers,
  },
  render: function RenderMobilePaginated(args): React.JSX.Element {
    return (
      <div className="w-[375px]">
        <SandboxProfileTriggersStory {...args} />
      </div>
    );
  },
};

export const SelectedScheduledTrigger: Story = {
  args: {
    selectedTriggerId: SelectedScheduleTriggerId,
  },
};

export const Empty: Story = {
  args: {
    triggers: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};
