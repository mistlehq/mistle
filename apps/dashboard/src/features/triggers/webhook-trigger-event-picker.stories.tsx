import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { WebhookTriggerEventPicker } from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";
import { createWebhookTriggerEventId } from "./webhook-trigger-option-builders.js";
import { createGitHubEventOption } from "./webhook-trigger-test-fixtures.js";

const GitHubConnectionId = "conn_github_prod";
const GitHubWebhookSourceId = "iws_github_prod";
const SlackConnectionId = "conn_slack_prod";
const SlackWebhookSourceId = "iws_slack_prod";
const IssueCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
const PullRequestOpenedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});
const PullRequestReviewCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request_review_comment.created",
});
const PullRequestReviewSubmittedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request_review.submitted",
});
const PushDeletedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.push.deleted",
});
const SlackAppMentionTriggerId = createWebhookTriggerEventId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:app_mention",
});

const GitHubEventOptions: readonly WebhookTriggerEventOption[] = [
  createGitHubEventOption({
    eventType: "github.issue_comment.created",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: IssueCommentCreatedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.issues.opened",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
  }),
  createGitHubEventOption({
    eventType: "github.pull_request.opened",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: PullRequestOpenedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review.submitted",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: PullRequestReviewSubmittedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review_comment.created",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: PullRequestReviewCommentCreatedTriggerId },
  }),
];

const StoryGithubRepositoryResources: IntegrationConnectionResources = {
  connectionId: GitHubConnectionId,
  familyId: "github",
  kind: "repository",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_repo_1",
      familyId: "github",
      kind: "repository",
      externalId: "repo_1",
      handle: "mistlehq/platform",
      displayName: "mistlehq/platform",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_github_repo_2",
      familyId: "github",
      kind: "repository",
      externalId: "repo_2",
      handle: "mistlehq/dashboard",
      displayName: "mistlehq/dashboard",
      status: "accessible",
      metadata: {},
    },
  ],
};

const StoryGithubBranchResources: IntegrationConnectionResources = {
  connectionId: GitHubConnectionId,
  familyId: "github",
  kind: "branch",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_branch_1",
      familyId: "github",
      kind: "branch",
      externalId: "repo_1:main",
      handle: "main",
      displayName: "main",
      status: "accessible",
      metadata: {
        repositoryFullName: "mistlehq/platform",
      },
    },
    {
      id: "icr_github_branch_2",
      familyId: "github",
      kind: "branch",
      externalId: "repo_1:release",
      handle: "release",
      displayName: "release",
      status: "accessible",
      metadata: {
        repositoryFullName: "mistlehq/platform",
      },
    },
  ],
};

const StoryGithubUserResources: IntegrationConnectionResources = {
  connectionId: GitHubConnectionId,
  familyId: "github",
  kind: "user",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_user_1",
      familyId: "github",
      kind: "user",
      externalId: "1001",
      handle: "octocat",
      displayName: "octocat",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_github_user_2",
      familyId: "github",
      kind: "user",
      externalId: "1002",
      handle: "hubot",
      displayName: "hubot",
      status: "accessible",
      metadata: {},
    },
  ],
};

const StorySlackChannelResources: IntegrationConnectionResources = {
  connectionId: SlackConnectionId,
  familyId: "slack",
  kind: "channel",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_slack_channel_1",
      familyId: "slack",
      kind: "channel",
      externalId: "C_ALERTS_001",
      handle: "C_ALERTS_001",
      displayName: "#alerts",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_slack_channel_2",
      familyId: "slack",
      kind: "channel",
      externalId: "C_ENG_001",
      handle: "C_ENG_001",
      displayName: "#engineering",
      status: "accessible",
      metadata: {},
    },
  ],
};

const SlackEventOptions: readonly WebhookTriggerEventOption[] = [
  {
    id: SlackAppMentionTriggerId,
    eventType: "slack:app_mention",
    integrationWebhookSourceId: SlackWebhookSourceId,
    connectionId: SlackConnectionId,
    connectionLabel: "Slack Engineering",
    label: "App mention",
    category: "Slack Engineering / Messages",
    logoKey: "slack",
    parameters: [
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
      },
    ],
  },
];

function createWebhookTriggerEventPickerStoryQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    ["trigger-trigger-parameters", GitHubConnectionId, "repository"],
    StoryGithubRepositoryResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", GitHubConnectionId, "branch"],
    StoryGithubBranchResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", GitHubConnectionId, "user"],
    StoryGithubUserResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", SlackConnectionId, "channel"],
    StorySlackChannelResources,
  );

  return queryClient;
}

function StoryHarness(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventParameterValues?: WebhookTriggerEventParameterValueMap;
  eventOptions: readonly WebhookTriggerEventOption[];
  error?: string;
}): React.JSX.Element {
  const [queryClient] = useState(() => createWebhookTriggerEventPickerStoryQueryClient());
  const [selectedEventIds, setSelectedEventIds] = useState([...input.selectedEventIds]);
  const [eventParameterValues, setEventParameterValues] = useState(
    input.eventParameterValues ?? {},
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-full max-w-6xl px-6 py-8">
        <WebhookTriggerEventPicker
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onEventParameterValueChange={({ triggerId, parameterId, value }) => {
            setEventParameterValues((currentValues) => ({
              ...currentValues,
              [triggerId]: {
                ...(currentValues[triggerId] ?? {}),
                [parameterId]: value,
              },
            }));
          }}
          onValueChange={setSelectedEventIds}
          selectedConnectionId={input.selectedConnectionId}
          selectedEventIds={selectedEventIds}
          eventParameterValues={eventParameterValues}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/Event/EventPicker",
  component: StoryHarness,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedEventIds: [PullRequestReviewCommentCreatedTriggerId],
    eventParameterValues: {
      [PullRequestReviewCommentCreatedTriggerId]: {
        invocationToken: "@mistlebot",
        commenter: "octocat",
        baseBranch: "main",
        repository: "mistlehq/platform",
      },
    },
    eventOptions: GitHubEventOptions,
  },
};

export const NoSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedEventIds: [],
    eventOptions: GitHubEventOptions,
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    hasConnectedIntegrations: false,
    selectedConnectionId: "",
    selectedEventIds: [],
    eventOptions: [],
  },
};

export const NoEventsAvailable: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedEventIds: [],
    eventOptions: [],
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedEventIds: [PushDeletedTriggerId],
    eventOptions: [
      ...GitHubEventOptions,
      {
        id: PushDeletedTriggerId,
        eventType: "github.push.deleted",
        integrationWebhookSourceId: GitHubWebhookSourceId,
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub Engineering",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        logoKey: "github",
        availability: "missing_integration",
      },
    ],
  },
};

export const WrongProfileSavedEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedEventIds: [IssueCommentCreatedTriggerId],
    eventOptions: [
      {
        id: IssueCommentCreatedTriggerId,
        eventType: "github.issue_comment.created",
        integrationWebhookSourceId: GitHubWebhookSourceId,
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub Engineering",
        label: "Issue comment created",
        category: "GitHub Engineering / Issues",
        logoKey: "github",
        availability: "wrong_profile",
        description: "Event is unavailable for the selected sandbox profile.",
      },
    ],
  },
};

export const SlackAppMentionChannelOnly: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: SlackConnectionId,
    selectedEventIds: [SlackAppMentionTriggerId],
    eventParameterValues: {
      [SlackAppMentionTriggerId]: {
        channel: "C_ALERTS_001",
      },
    },
    eventOptions: SlackEventOptions,
  },
};

export const SlackUnavailableArchivedChannelSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: SlackConnectionId,
    selectedEventIds: [SlackAppMentionTriggerId],
    eventParameterValues: {
      [SlackAppMentionTriggerId]: {
        channel: "C_ARCHIVED_001",
      },
    },
    eventOptions: SlackEventOptions,
  },
};

export const AddSecondEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedEventIds: [IssueCommentCreatedTriggerId],
    eventParameterValues: {
      [IssueCommentCreatedTriggerId]: {
        invocationToken: "@mistlebot",
      },
    },
    eventOptions: GitHubEventOptions,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const addTriggerInput = canvas.getByPlaceholderText("Add event");

    await userEvent.click(addTriggerInput);
    await userEvent.click(await canvas.findByRole("option", { name: "Pull request opened" }));

    await expect(
      canvas.getByRole("button", { name: "Remove Issue comment created trigger" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Remove Pull request opened trigger" }),
    ).toBeVisible();
  },
};
