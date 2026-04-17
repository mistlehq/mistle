import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import { createGitHubEventOption } from "./webhook-automation-test-fixtures.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

const GitHubConnectionId = "conn_github_prod";
const GitHubWebhookSourceId = "iws_github_prod";
const SlackConnectionId = "conn_slack_prod";
const SlackWebhookSourceId = "iws_slack_prod";
const IssueCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
const PullRequestOpenedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});
const PullRequestReviewCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request_review_comment.created",
});
const PullRequestReviewSubmittedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request_review.submitted",
});
const PushDeletedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.push.deleted",
});
const SlackAppMentionTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:app_mention",
});

const GitHubEventOptions: readonly WebhookAutomationEventOption[] = [
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

const SlackEventOptions: readonly WebhookAutomationEventOption[] = [
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

function createWebhookAutomationTriggerPickerStoryQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    ["automation-trigger-parameters", GitHubConnectionId, "repository"],
    StoryGithubRepositoryResources,
  );
  queryClient.setQueryData(
    ["automation-trigger-parameters", GitHubConnectionId, "branch"],
    StoryGithubBranchResources,
  );
  queryClient.setQueryData(
    ["automation-trigger-parameters", GitHubConnectionId, "user"],
    StoryGithubUserResources,
  );
  queryClient.setQueryData(
    ["automation-trigger-parameters", SlackConnectionId, "channel"],
    StorySlackChannelResources,
  );

  return queryClient;
}

function StoryHarness(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedTriggerIds: readonly string[];
  triggerParameterValues?: WebhookAutomationTriggerParameterValueMap;
  eventOptions: readonly WebhookAutomationEventOption[];
  error?: string;
}): React.JSX.Element {
  const [queryClient] = useState(() => createWebhookAutomationTriggerPickerStoryQueryClient());
  const [selectedTriggerIds, setSelectedTriggerIds] = useState([...input.selectedTriggerIds]);
  const [triggerParameterValues, setTriggerParameterValues] = useState(
    input.triggerParameterValues ?? {},
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-full max-w-6xl px-6 py-8">
        <WebhookAutomationTriggerPicker
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onTriggerParameterValueChange={({ triggerId, parameterId, value }) => {
            setTriggerParameterValues((currentValues) => ({
              ...currentValues,
              [triggerId]: {
                ...(currentValues[triggerId] ?? {}),
                [parameterId]: value,
              },
            }));
          }}
          onValueChange={setSelectedTriggerIds}
          selectedConnectionId={input.selectedConnectionId}
          selectedTriggerIds={selectedTriggerIds}
          triggerParameterValues={triggerParameterValues}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Automations/WebhookAutomation/TriggerPicker",
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
    selectedTriggerIds: [PullRequestOpenedTriggerId],
    triggerParameterValues: {
      [PullRequestOpenedTriggerId]: {
        author: "octocat",
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
    selectedTriggerIds: [],
    eventOptions: GitHubEventOptions,
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    hasConnectedIntegrations: false,
    selectedConnectionId: "",
    selectedTriggerIds: [],
    eventOptions: [],
  },
};

export const NoTriggersAvailable: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedTriggerIds: [],
    eventOptions: [],
  },
};

export const UnavailableSavedTrigger: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedTriggerIds: [PushDeletedTriggerId],
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

export const WrongProfileSavedTrigger: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedTriggerIds: [IssueCommentCreatedTriggerId],
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
        description: "Trigger is unavailable for the selected sandbox profile.",
      },
    ],
  },
};

export const SlackAppMentionChannelOnly: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: SlackConnectionId,
    selectedTriggerIds: [SlackAppMentionTriggerId],
    triggerParameterValues: {
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
    selectedTriggerIds: [SlackAppMentionTriggerId],
    triggerParameterValues: {
      [SlackAppMentionTriggerId]: {
        channel: "C_ARCHIVED_001",
      },
    },
    eventOptions: SlackEventOptions,
  },
};

export const AddSecondTrigger: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedTriggerIds: [IssueCommentCreatedTriggerId],
    triggerParameterValues: {
      [IssueCommentCreatedTriggerId]: {
        invocationToken: "@mistlebot",
      },
    },
    eventOptions: GitHubEventOptions,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const addTriggerInput = canvas.getByPlaceholderText("Add trigger");

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
