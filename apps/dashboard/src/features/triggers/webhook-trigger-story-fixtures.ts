import { QueryClient } from "@tanstack/react-query";

import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import {
  createSlackChannelResource,
  createSlackChannelResources,
  createSlackUserGroupResource,
  createSlackUserGroupResources,
  createSlackUserResource,
  createSlackUserResources,
} from "../integrations/slack-channel-resource-story-support.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import { createWebhookTriggerEventId } from "./webhook-trigger-option-builders.js";
import { createGitHubEventOption } from "./webhook-trigger-test-fixtures.js";

export const StoryGitHubConnectionId = "conn_github_prod";
export const StoryGitHubWebhookSourceId = "iws_github_prod";
export const StorySlackConnectionId = "conn_slack_prod";
export const StorySlackWebhookSourceId = "iws_slack_prod";
export const StoryWasenderApiConnectionId = "conn_wasenderapi_prod";
export const StoryWasenderApiWebhookSourceId = "iws_wasenderapi_prod";
export const StoryWhapiConnectionId = "conn_whapi_prod";
export const StoryWhapiWebhookSourceId = "iws_whapi_prod";

export function isRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value,
  };
}

export function isNotRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
    value,
  };
}

export function containsTokenRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
    value,
  };
}

export function containsRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS,
    value,
  };
}

export const StoryIssueCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
export const StoryPullRequestOpenedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});
export const StoryPullRequestReviewRequestedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request.review_requested",
});
export const StoryPullRequestReviewCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request_review_comment.created",
});
export const StoryPullRequestReviewSubmittedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request_review.submitted",
});
export const StoryPushDeletedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.push.deleted",
});
export const StorySlackAppMentionTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StorySlackWebhookSourceId,
  eventType: "slack:app_mention",
});
export const StorySlackMessageTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StorySlackWebhookSourceId,
  eventType: "slack:message",
});
export const StorySlackReactionAddedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StorySlackWebhookSourceId,
  eventType: "slack:reaction_added",
});
export const StorySlackReactionRemovedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StorySlackWebhookSourceId,
  eventType: "slack:reaction_removed",
});
export const StoryWasenderApiMessagesUpsertTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWasenderApiWebhookSourceId,
  eventType: "wasenderapi.messages.upsert",
});
export const StoryWasenderApiMessagesReceivedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWasenderApiWebhookSourceId,
  eventType: "wasenderapi.messages.received",
});
export const StoryWhapiMessagesPostTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWhapiWebhookSourceId,
  eventType: "whapi.messages.post",
});
export const StoryWhapiMessagesPatchTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWhapiWebhookSourceId,
  eventType: "whapi.messages.patch",
});
export const StoryWhapiStatusesPostTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWhapiWebhookSourceId,
  eventType: "whapi.statuses.post",
});
export const StoryWhapiChannelPostTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWhapiWebhookSourceId,
  eventType: "whapi.channel.post",
});
export const StoryWhapiUsersPostTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWhapiWebhookSourceId,
  eventType: "whapi.users.post",
});
export const StoryWhapiUsersDeleteTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryWhapiWebhookSourceId,
  eventType: "whapi.users.delete",
});

const StoryGitHubRepositoryResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
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

const StoryGitHubBranchResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
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

const StoryGitHubUserResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
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

const StoryGitHubTeamResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "team",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_team_1",
      familyId: "github",
      kind: "team",
      handle: "platform",
      displayName: "Platform (mistlehq)",
      status: "accessible",
      metadata: {
        organizationLogins: ["mistlehq"],
      },
    },
    {
      id: "icr_github_team_2",
      familyId: "github",
      kind: "team",
      handle: "security",
      displayName: "Security (mistlehq)",
      status: "accessible",
      metadata: {
        organizationLogins: ["mistlehq"],
      },
    },
  ],
};

const StoryGitHubBotResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "bot",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_bot_1",
      familyId: "github",
      kind: "bot",
      externalId: "3001",
      handle: "dependabot[bot]",
      displayName: "dependabot[bot]",
      status: "accessible",
      metadata: {
        appSlug: "dependabot",
      },
    },
    {
      id: "icr_github_bot_2",
      familyId: "github",
      kind: "bot",
      externalId: "3002",
      handle: "mistle-reviewer[bot]",
      displayName: "mistle-reviewer[bot]",
      status: "accessible",
      metadata: {
        appSlug: "mistle-reviewer",
      },
    },
  ],
};

export const StoryGitHubTeamResourcesSyncFailed: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "team",
  syncState: "error",
  lastErrorMessage:
    "GitHub returned 403 while listing teams. Reapprove Members read permission for this installation.",
  items: [],
};

const StorySlackChannelResources = createSlackChannelResources({
  connectionId: StorySlackConnectionId,
  items: [
    createSlackChannelResource({
      index: 1,
      externalId: "C_ALERTS_001",
      displayName: "#alerts",
    }),
    createSlackChannelResource({
      index: 2,
      externalId: "C_ENG_001",
      displayName: "#engineering",
    }),
  ],
});

const StorySlackUserResources = createSlackUserResources({
  connectionId: StorySlackConnectionId,
  items: [
    createSlackUserResource({
      index: 1,
      externalId: "U1234567890",
      displayName: "Ari Tan",
    }),
    createSlackUserResource({
      index: 2,
      externalId: "U9999999999",
      displayName: "Release Bot",
      isBot: true,
    }),
    createSlackUserResource({
      index: 3,
      externalId: "U5555555555",
      displayName: "Mina Patel",
    }),
  ],
});

const StorySlackUserGroupResources = createSlackUserGroupResources({
  connectionId: StorySlackConnectionId,
  items: [
    createSlackUserGroupResource({
      index: 1,
      externalId: "S_ENG",
      handle: "eng-oncall",
      displayName: "@eng-oncall",
      userCount: 14,
    }),
    createSlackUserGroupResource({
      index: 2,
      externalId: "S_SUPPORT",
      handle: "support-escalations",
      displayName: "@support-escalations",
      userCount: 8,
    }),
  ],
});

export const StorySlackChannelResourcesSyncing: IntegrationConnectionResources = {
  ...StorySlackChannelResources,
  syncState: "syncing",
};

export const StoryGitHubEventOptions: readonly WebhookTriggerEventOption[] = [
  createGitHubEventOption({
    eventType: "github.issue_comment.created",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryIssueCommentCreatedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.issues.opened",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
  }),
  createGitHubEventOption({
    eventType: "github.pull_request.opened",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestOpenedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request.review_requested",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestReviewRequestedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review.submitted",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestReviewSubmittedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review_comment.created",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestReviewCommentCreatedTriggerId },
  }),
];

export const StorySlackEventOptions: readonly WebhookTriggerEventOption[] = [
  {
    id: StorySlackAppMentionTriggerId,
    eventType: "slack:app_mention",
    integrationWebhookSourceId: StorySlackWebhookSourceId,
    connectionId: StorySlackConnectionId,
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
        multiValue: true,
      },
      {
        id: "userMention",
        label: "user mention",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        matchValuePrefix: "<@",
        prefix: "mentioning user",
        placeholder: "Any mentioned user",
        multiValue: true,
      },
      {
        id: "userGroupMention",
        label: "user group mention",
        kind: "resource-select",
        resourceKind: "user_group",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        matchValuePrefix: "<!subteam^",
        prefix: "mentioning group",
        placeholder: "Any user group",
        multiValue: true,
      },
    ],
  },
  {
    id: StorySlackMessageTriggerId,
    eventType: "slack:message",
    integrationWebhookSourceId: StorySlackWebhookSourceId,
    connectionId: StorySlackConnectionId,
    connectionLabel: "Slack Engineering",
    label: "Message",
    category: "Slack Engineering / Messages",
    logoKey: "slack",
    parameters: [
      {
        id: "invocationToken",
        label: "invocation token",
        kind: "string",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        controlVariant: "invocation-token",
      },
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
        multiValue: true,
      },
      {
        id: "sender",
        label: "sender",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "user"],
        multiValue: true,
        prefix: "from",
        placeholder: "Any sender",
      },
      {
        id: "userMention",
        label: "user mention",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        matchValuePrefix: "<@",
        multiValue: true,
        prefix: "mentioning user",
        placeholder: "Any mentioned user",
      },
      {
        id: "userGroupMention",
        label: "user group mention",
        kind: "resource-select",
        resourceKind: "user_group",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        matchValuePrefix: "<!subteam^",
        multiValue: true,
        prefix: "mentioning group",
        placeholder: "Any user group",
      },
      {
        id: "messageText",
        label: "message text",
        kind: "string",
        payloadPath: ["event", "text"],
        matchMode: "contains",
        prefix: "containing",
        placeholder: "deployment failed",
      },
      {
        id: "messageType",
        label: "message type",
        kind: "enum-select",
        payloadPath: ["event", "thread_ts"],
        matchMode: "payload_filter",
        placeholder: "Any message",
        options: [
          {
            value: "channel_or_dm_message",
            label: "Channel or DM message",
            payloadFilter: {
              op: "not",
              filter: {
                op: "and",
                filters: [
                  {
                    op: "exists",
                    path: ["event", "thread_ts"],
                  },
                  {
                    op: "neq_path",
                    path: ["event", "thread_ts"],
                    otherPath: ["event", "ts"],
                  },
                ],
              },
            },
          },
          {
            value: "thread_reply",
            label: "Thread reply",
            payloadFilter: {
              op: "and",
              filters: [
                {
                  op: "exists",
                  path: ["event", "thread_ts"],
                },
                {
                  op: "neq_path",
                  path: ["event", "thread_ts"],
                  otherPath: ["event", "ts"],
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: StorySlackReactionAddedTriggerId,
    eventType: "slack:reaction_added",
    integrationWebhookSourceId: StorySlackWebhookSourceId,
    connectionId: StorySlackConnectionId,
    connectionLabel: "Slack Engineering",
    label: "Reaction added",
    category: "Slack Engineering / Reactions",
    logoKey: "slack",
    parameters: [
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
        multiValue: true,
      },
      {
        id: "reaction",
        label: "reaction",
        kind: "string",
        payloadPath: ["event", "reaction"],
        prefix: "named",
        placeholder: "thumbsup",
      },
      {
        id: "reactingUser",
        label: "reacting user",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "user"],
        multiValue: true,
        prefix: "by",
        placeholder: "Any reacting user",
      },
      {
        id: "reactedMessageAuthor",
        label: "message author",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "item_user"],
        multiValue: true,
        prefix: "on message by",
        placeholder: "Any message author",
        negatedMatchRequiresExists: true,
      },
    ],
  },
  {
    id: StorySlackReactionRemovedTriggerId,
    eventType: "slack:reaction_removed",
    integrationWebhookSourceId: StorySlackWebhookSourceId,
    connectionId: StorySlackConnectionId,
    connectionLabel: "Slack Engineering",
    label: "Reaction removed",
    category: "Slack Engineering / Reactions",
    logoKey: "slack",
    parameters: [
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
        multiValue: true,
      },
      {
        id: "reaction",
        label: "reaction",
        kind: "string",
        payloadPath: ["event", "reaction"],
        prefix: "named",
        placeholder: "thumbsup",
      },
      {
        id: "reactingUser",
        label: "reacting user",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "user"],
        multiValue: true,
        prefix: "by",
        placeholder: "Any reacting user",
      },
      {
        id: "reactedMessageAuthor",
        label: "message author",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["event", "item_user"],
        multiValue: true,
        prefix: "on message by",
        placeholder: "Any message author",
        negatedMatchRequiresExists: true,
      },
    ],
  },
];

export const StoryWasenderApiEventOptions: readonly WebhookTriggerEventOption[] = [
  {
    id: StoryWasenderApiMessagesUpsertTriggerId,
    eventType: "wasenderapi.messages.upsert",
    integrationWebhookSourceId: StoryWasenderApiWebhookSourceId,
    connectionId: StoryWasenderApiConnectionId,
    connectionLabel: "WasenderAPI Production",
    label: "Message upsert",
    category: "WasenderAPI Production / Messages",
    logoKey: "wasenderapi",
  },
  {
    id: StoryWasenderApiMessagesReceivedTriggerId,
    eventType: "wasenderapi.messages.received",
    integrationWebhookSourceId: StoryWasenderApiWebhookSourceId,
    connectionId: StoryWasenderApiConnectionId,
    connectionLabel: "WasenderAPI Production",
    label: "Message received",
    category: "WasenderAPI Production / Messages",
    logoKey: "wasenderapi",
  },
];

export const StoryWhapiEventOptions: readonly WebhookTriggerEventOption[] = [
  {
    id: StoryWhapiMessagesPostTriggerId,
    eventType: "whapi.messages.post",
    integrationWebhookSourceId: StoryWhapiWebhookSourceId,
    connectionId: StoryWhapiConnectionId,
    connectionLabel: "Whapi Support Channel",
    label: "Message created",
    category: "Whapi Support Channel / Messages",
    logoKey: "whapi",
  },
  {
    id: StoryWhapiMessagesPatchTriggerId,
    eventType: "whapi.messages.patch",
    integrationWebhookSourceId: StoryWhapiWebhookSourceId,
    connectionId: StoryWhapiConnectionId,
    connectionLabel: "Whapi Support Channel",
    label: "Message patched",
    category: "Whapi Support Channel / Messages",
    logoKey: "whapi",
  },
  {
    id: StoryWhapiStatusesPostTriggerId,
    eventType: "whapi.statuses.post",
    integrationWebhookSourceId: StoryWhapiWebhookSourceId,
    connectionId: StoryWhapiConnectionId,
    connectionLabel: "Whapi Support Channel",
    label: "Status created",
    category: "Whapi Support Channel / Statuses",
    logoKey: "whapi",
  },
  {
    id: StoryWhapiChannelPostTriggerId,
    eventType: "whapi.channel.post",
    integrationWebhookSourceId: StoryWhapiWebhookSourceId,
    connectionId: StoryWhapiConnectionId,
    connectionLabel: "Whapi Support Channel",
    label: "Channel status changed",
    category: "Whapi Support Channel / Channel",
    logoKey: "whapi",
  },
  {
    id: StoryWhapiUsersPostTriggerId,
    eventType: "whapi.users.post",
    integrationWebhookSourceId: StoryWhapiWebhookSourceId,
    connectionId: StoryWhapiConnectionId,
    connectionLabel: "Whapi Support Channel",
    label: "User connected",
    category: "Whapi Support Channel / Users",
    logoKey: "whapi",
  },
  {
    id: StoryWhapiUsersDeleteTriggerId,
    eventType: "whapi.users.delete",
    integrationWebhookSourceId: StoryWhapiWebhookSourceId,
    connectionId: StoryWhapiConnectionId,
    connectionLabel: "Whapi Support Channel",
    label: "User disconnected",
    category: "Whapi Support Channel / Users",
    logoKey: "whapi",
  },
];

export function createWebhookTriggerStoryQueryClient(input?: {
  githubTeamResources?: IntegrationConnectionResources;
  slackChannelResources?: IntegrationConnectionResources;
  slackUserGroupResources?: IntegrationConnectionResources;
  slackUserResources?: IntegrationConnectionResources;
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
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "repository"],
    StoryGitHubRepositoryResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "branch"],
    StoryGitHubBranchResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "user"],
    StoryGitHubUserResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "team"],
    input?.githubTeamResources ?? StoryGitHubTeamResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "bot"],
    StoryGitHubBotResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StorySlackConnectionId, "channel"],
    input?.slackChannelResources ?? StorySlackChannelResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StorySlackConnectionId, "user"],
    input?.slackUserResources ?? StorySlackUserResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StorySlackConnectionId, "user_group"],
    input?.slackUserGroupResources ?? StorySlackUserGroupResources,
  );

  return queryClient;
}
