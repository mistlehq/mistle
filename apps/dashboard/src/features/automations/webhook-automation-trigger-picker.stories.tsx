import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

const GitHubConnectionId = "conn_github_prod";
const IssueCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.issue_comment.created",
});
const PullRequestOpenedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.pull_request.opened",
});
const PullRequestReviewCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.pull_request_review_comment.created",
});
const PushDeletedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.push.deleted",
});

const GitHubEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    id: IssueCommentCreatedTriggerId,
    eventType: "github.issue_comment.created",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Issue comment created",
    category: "GitHub Engineering / Issues",
    logoKey: "github",
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["comment", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
      {
        id: "target",
        label: "comment target",
        kind: "enum-select",
        payloadPath: ["issue", "pull_request"],
        matchMode: "exists",
        options: [
          {
            value: "exists",
            label: "pull request",
          },
          {
            value: "not_exists",
            label: "issue",
          },
        ],
        prefix: "in",
        placeholder: "Any comment target",
      },
      {
        id: "commenter",
        label: "commenter",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["sender", "login"],
        prefix: "by",
        placeholder: "Any commenter",
      },
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
    ],
  },
  {
    id: createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
      eventType: "github.issue.opened",
    }),
    eventType: "github.issue.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Issue opened",
    category: "GitHub Engineering / Issues",
    logoKey: "github",
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["issue", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
    ],
  },
  {
    id: PullRequestOpenedTriggerId,
    eventType: "github.pull_request.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request opened",
    category: "GitHub Engineering / Pull requests",
    logoKey: "github",
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["pull_request", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
      {
        id: "author",
        label: "author",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["sender", "login"],
        prefix: "by",
        placeholder: "Any author",
      },
      {
        id: "baseBranch",
        label: "base branch",
        kind: "resource-select",
        resourceKind: "branch",
        payloadPath: ["pull_request", "base", "ref"],
        prefix: "to",
        placeholder: "Any base branch",
      },
    ],
  },
  {
    id: PullRequestReviewCommentCreatedTriggerId,
    eventType: "github.pull_request_review_comment.created",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request review comment created",
    category: "GitHub Engineering / Pull requests",
    logoKey: "github",
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["comment", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
    ],
  },
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
      <div className="max-w-3xl">
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
  title: "Dashboard/Automations/WebhookAutomationTriggerPicker",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: GitHubConnectionId,
    selectedTriggerIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
    triggerParameterValues: {
      [PullRequestOpenedTriggerId]: {
        author: "octocat",
        baseBranch: "main",
        repository: "mistlehq/platform",
      },
      [IssueCommentCreatedTriggerId]: {
        explicitInvocation: "@mistlebot",
        target: "exists",
        commenter: "hubot",
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
    selectedTriggerIds: [PullRequestOpenedTriggerId, PushDeletedTriggerId],
    eventOptions: [
      ...GitHubEventOptions,
      {
        id: PushDeletedTriggerId,
        eventType: "github.push.deleted",
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
    selectedTriggerIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
    eventOptions: [
      {
        id: IssueCommentCreatedTriggerId,
        eventType: "github.issue_comment.created",
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub Engineering",
        label: "Issue comment created",
        category: "GitHub Engineering / Issues",
        logoKey: "github",
        availability: "wrong_profile",
        description: "Trigger is unavailable for the selected sandbox profile.",
      },
      GitHubEventOptions[2]!,
    ],
  },
};
