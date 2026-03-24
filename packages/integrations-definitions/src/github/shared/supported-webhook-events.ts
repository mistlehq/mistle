import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
} from "@mistle/integrations-core";

const GitHubRepositoryConversationKeyOption = {
  id: "repository",
  label: "Repository",
  description: "Events from the same repository go to the same conversation.",
  template: "{{payload.repository.full_name}}",
} as const;

const GitHubIssueConversationKeyOption = {
  id: "issue",
  label: "Issue",
  description: "Events from the same issue go to the same conversation.",
  template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
} as const;

const GitHubPullRequestConversationKeyOption = {
  id: "pull-request",
  label: "Pull request",
  description: "Events from the same pull request go to the same conversation.",
  template: "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
} as const;

const GitHubPushBranchConversationKeyOption = {
  id: "branch",
  label: "Branch",
  description: "Events from the same branch go to the same conversation.",
  template: "{{payload.repository.full_name}}:branch:{{payload.ref}}",
} as const;

const GitHubRepositoryParameter: IntegrationWebhookEventParameterDefinition = {
  id: "repository",
  label: "repository",
  kind: "resource-select",
  resourceKind: "repository",
  payloadPath: ["repository", "full_name"],
  prefix: "in",
};

const GitHubAuthorParameter: IntegrationWebhookEventParameterDefinition = {
  id: "author",
  label: "author",
  kind: "resource-select",
  resourceKind: "user",
  payloadPath: ["sender", "login"],
  prefix: "by",
  placeholder: "Any author",
};

const GitHubCommenterParameter: IntegrationWebhookEventParameterDefinition = {
  id: "commenter",
  label: "commenter",
  kind: "resource-select",
  resourceKind: "user",
  payloadPath: ["sender", "login"],
  prefix: "by",
  placeholder: "Any commenter",
};

const GitHubIssueCommentTargetParameter: IntegrationWebhookEventParameterDefinition = {
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
};

const GitHubBaseBranchParameter: IntegrationWebhookEventParameterDefinition = {
  id: "baseBranch",
  label: "base branch",
  kind: "resource-select",
  resourceKind: "branch",
  payloadPath: ["pull_request", "base", "ref"],
  prefix: "to",
  placeholder: "Any base branch",
};

const GitHubHeadBranchParameter: IntegrationWebhookEventParameterDefinition = {
  id: "headBranch",
  label: "head branch",
  kind: "resource-select",
  resourceKind: "branch",
  payloadPath: ["pull_request", "head", "ref"],
  prefix: "from",
  placeholder: "Any head branch",
};

const GitHubPushBranchParameter: IntegrationWebhookEventParameterDefinition = {
  id: "branch",
  label: "branch",
  kind: "string",
  payloadPath: ["ref"],
  prefix: "to",
  placeholder: "refs/heads/main",
};

function createGitHubWebhookEventDefinition(input: {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category: string;
  conversationKeyOptions?: readonly {
    id: string;
    label: string;
    description: string;
    template: string;
  }[];
  parameters?: readonly IntegrationWebhookEventParameterDefinition[];
}): IntegrationWebhookEventDefinition {
  return {
    eventType: input.eventType,
    providerEventType: input.providerEventType,
    displayName: input.displayName,
    category: input.category,
    ...(input.conversationKeyOptions === undefined
      ? {}
      : { conversationKeyOptions: input.conversationKeyOptions }),
    ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
  };
}

export const GitHubSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  createGitHubWebhookEventDefinition({
    eventType: "github.issues.opened",
    providerEventType: "issues",
    displayName: "Issue opened",
    category: "Issues",
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.issues.closed",
    providerEventType: "issues",
    displayName: "Issue closed",
    category: "Issues",
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.issues.reopened",
    providerEventType: "issues",
    displayName: "Issue reopened",
    category: "Issues",
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.issue_comment.created",
    providerEventType: "issue_comment",
    displayName: "Issue comment created",
    category: "Issues",
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      GitHubIssueCommentTargetParameter,
      GitHubRepositoryParameter,
      GitHubCommenterParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request.opened",
    providerEventType: "pull_request",
    displayName: "Pull request opened",
    category: "Pull requests",
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter, GitHubBaseBranchParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request.closed",
    providerEventType: "pull_request",
    displayName: "Pull request closed",
    category: "Pull requests",
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter, GitHubBaseBranchParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request.reopened",
    providerEventType: "pull_request",
    displayName: "Pull request reopened",
    category: "Pull requests",
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter, GitHubBaseBranchParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request.synchronize",
    providerEventType: "pull_request",
    displayName: "Pull request updated",
    category: "Pull requests",
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      GitHubRepositoryParameter,
      GitHubAuthorParameter,
      GitHubBaseBranchParameter,
      GitHubHeadBranchParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request_review.submitted",
    providerEventType: "pull_request_review",
    displayName: "Pull request review submitted",
    category: "Pull requests",
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubAuthorParameter, GitHubBaseBranchParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request_review_comment.created",
    providerEventType: "pull_request_review_comment",
    displayName: "Pull request review comment created",
    category: "Pull requests",
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubCommenterParameter, GitHubBaseBranchParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.push.pushed",
    providerEventType: "push",
    displayName: "New push to branch",
    category: "Push",
    conversationKeyOptions: [
      GitHubPushBranchConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [GitHubRepositoryParameter, GitHubPushBranchParameter],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.check_suite.completed",
    providerEventType: "check_suite",
    displayName: "CI completed",
    category: "Checks",
    conversationKeyOptions: [GitHubRepositoryConversationKeyOption],
    parameters: [GitHubRepositoryParameter],
  }),
];
