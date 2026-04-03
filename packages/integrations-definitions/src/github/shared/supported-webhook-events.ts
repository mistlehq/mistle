import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookPayloadReference,
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

function createGitHubPayloadReference(input: {
  path: ReadonlyArray<string>;
  description: string;
}): IntegrationWebhookPayloadReference {
  return {
    path: [...input.path],
    description: input.description,
  };
}

const GitHubRepositoryFullNamePayloadReference = createGitHubPayloadReference({
  path: ["repository", "full_name"],
  description: "Repository owner and name",
});

const GitHubIssueNumberPayloadReference = createGitHubPayloadReference({
  path: ["issue", "number"],
  description: "Issue number",
});

const GitHubIssueTitlePayloadReference = createGitHubPayloadReference({
  path: ["issue", "title"],
  description: "Issue title",
});

const GitHubIssueBodyPayloadReference = createGitHubPayloadReference({
  path: ["issue", "body"],
  description: "Issue description",
});

const GitHubIssuePullRequestPayloadReference = createGitHubPayloadReference({
  path: ["issue", "pull_request"],
  description: "Present when the issue is a pull request",
});

const GitHubPullRequestNumberPayloadReference = createGitHubPayloadReference({
  path: ["pull_request", "number"],
  description: "Pull request number",
});

const GitHubPullRequestBodyPayloadReference = createGitHubPayloadReference({
  path: ["pull_request", "body"],
  description: "Pull request description",
});

const GitHubPullRequestBaseRefPayloadReference = createGitHubPayloadReference({
  path: ["pull_request", "base", "ref"],
  description: "Base branch name",
});

const GitHubPullRequestHeadRefPayloadReference = createGitHubPayloadReference({
  path: ["pull_request", "head", "ref"],
  description: "Head branch name",
});

const GitHubCommentBodyPayloadReference = createGitHubPayloadReference({
  path: ["comment", "body"],
  description: "Comment text",
});

const GitHubSenderLoginPayloadReference = createGitHubPayloadReference({
  path: ["sender", "login"],
  description: "GitHub username of the sender",
});

const GitHubReviewBodyPayloadReference = createGitHubPayloadReference({
  path: ["review", "body"],
  description: "Pull request review body",
});

const GitHubRefPayloadReference = createGitHubPayloadReference({
  path: ["ref"],
  description: "Git ref for the event",
});

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

function createGitHubExplicitInvocationParameter(
  payloadPath: ReadonlyArray<string>,
): IntegrationWebhookEventParameterDefinition {
  return {
    id: "explicitInvocation",
    label: "explicit mention",
    kind: "string",
    payloadPath: [...payloadPath],
    matchMode: "contains_token",
    defaultValue: "@mistlebot",
    defaultEnabled: true,
    controlVariant: "explicit-invocation",
    placeholder: 'Require "@mistlebot"',
  };
}

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
  payloadReferences?: readonly IntegrationWebhookPayloadReference[];
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
    ...(input.payloadReferences === undefined
      ? {}
      : { payloadReferences: input.payloadReferences }),
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubIssueNumberPayloadReference,
      GitHubIssueTitlePayloadReference,
      GitHubIssueBodyPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createGitHubExplicitInvocationParameter(["issue", "body"]),
      GitHubRepositoryParameter,
      GitHubAuthorParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.issues.closed",
    providerEventType: "issues",
    displayName: "Issue closed",
    category: "Issues",
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubIssueNumberPayloadReference,
      GitHubIssueTitlePayloadReference,
      GitHubIssueBodyPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubIssueNumberPayloadReference,
      GitHubIssueTitlePayloadReference,
      GitHubIssueBodyPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubIssueNumberPayloadReference,
      GitHubIssueTitlePayloadReference,
      GitHubIssuePullRequestPayloadReference,
      GitHubCommentBodyPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createGitHubExplicitInvocationParameter(["comment", "body"]),
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubPullRequestNumberPayloadReference,
      GitHubPullRequestBodyPayloadReference,
      GitHubPullRequestBaseRefPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createGitHubExplicitInvocationParameter(["pull_request", "body"]),
      GitHubRepositoryParameter,
      GitHubAuthorParameter,
      GitHubBaseBranchParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request.closed",
    providerEventType: "pull_request",
    displayName: "Pull request closed",
    category: "Pull requests",
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubPullRequestNumberPayloadReference,
      GitHubPullRequestBodyPayloadReference,
      GitHubPullRequestBaseRefPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubPullRequestNumberPayloadReference,
      GitHubPullRequestBodyPayloadReference,
      GitHubPullRequestBaseRefPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubPullRequestNumberPayloadReference,
      GitHubPullRequestBodyPayloadReference,
      GitHubPullRequestBaseRefPayloadReference,
      GitHubPullRequestHeadRefPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
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
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubPullRequestNumberPayloadReference,
      GitHubPullRequestBaseRefPayloadReference,
      GitHubReviewBodyPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createGitHubExplicitInvocationParameter(["review", "body"]),
      GitHubRepositoryParameter,
      GitHubAuthorParameter,
      GitHubBaseBranchParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.pull_request_review_comment.created",
    providerEventType: "pull_request_review_comment",
    displayName: "Pull request review comment created",
    category: "Pull requests",
    payloadReferences: [
      GitHubRepositoryFullNamePayloadReference,
      GitHubPullRequestNumberPayloadReference,
      GitHubPullRequestBaseRefPayloadReference,
      GitHubCommentBodyPayloadReference,
      GitHubSenderLoginPayloadReference,
    ],
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createGitHubExplicitInvocationParameter(["comment", "body"]),
      GitHubRepositoryParameter,
      GitHubCommenterParameter,
      GitHubBaseBranchParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.push.pushed",
    providerEventType: "push",
    displayName: "New push to branch",
    category: "Push",
    payloadReferences: [GitHubRepositoryFullNamePayloadReference, GitHubRefPayloadReference],
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
    payloadReferences: [GitHubRepositoryFullNamePayloadReference],
    conversationKeyOptions: [GitHubRepositoryConversationKeyOption],
    parameters: [GitHubRepositoryParameter],
  }),
];
