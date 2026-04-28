import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookPayloadReference,
  IntegrationWebhookTriggerProviderPermissionRequirement,
  IntegrationWebhookTriggerRequirements,
} from "@mistle/integrations-core";

import { createInvocationTokenParameter } from "../../shared/invocation-token-parameter.js";

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

const GitHubPayloadReferences = {
  REPOSITORY_FULL_NAME: {
    path: ["repository", "full_name"],
    description: "Repository owner and name",
  },
  ISSUE_NUMBER: {
    path: ["issue", "number"],
    description: "Issue number",
  },
  ISSUE_TITLE: {
    path: ["issue", "title"],
    description: "Issue title",
  },
  ISSUE_BODY: {
    path: ["issue", "body"],
    description: "Issue description",
  },
  ISSUE_PULL_REQUEST: {
    path: ["issue", "pull_request"],
    description: "Present when the issue is a pull request",
  },
  PULL_REQUEST_NUMBER: {
    path: ["pull_request", "number"],
    description: "Pull request number",
  },
  PULL_REQUEST_BODY: {
    path: ["pull_request", "body"],
    description: "Pull request description",
  },
  PULL_REQUEST_BASE_REF: {
    path: ["pull_request", "base", "ref"],
    description: "Base branch name",
  },
  PULL_REQUEST_HEAD_REF: {
    path: ["pull_request", "head", "ref"],
    description: "Head branch name",
  },
  COMMENT_BODY: {
    path: ["comment", "body"],
    description: "Comment text",
  },
  REVIEW_BODY: {
    path: ["review", "body"],
    description: "Pull request review body",
  },
  SENDER_LOGIN: {
    path: ["sender", "login"],
    description: "GitHub username of the sender",
  },
  REF: {
    path: ["ref"],
    description: "Git ref for the event",
  },
} as const satisfies Record<string, IntegrationWebhookPayloadReference>;

const GitHubPayloadReferenceGroups = {
  ISSUE_CORE: [
    GitHubPayloadReferences.REPOSITORY_FULL_NAME,
    GitHubPayloadReferences.ISSUE_NUMBER,
    GitHubPayloadReferences.ISSUE_TITLE,
    GitHubPayloadReferences.ISSUE_BODY,
    GitHubPayloadReferences.SENDER_LOGIN,
  ],
  ISSUE_COMMENT_CORE: [
    GitHubPayloadReferences.REPOSITORY_FULL_NAME,
    GitHubPayloadReferences.ISSUE_NUMBER,
    GitHubPayloadReferences.ISSUE_TITLE,
    GitHubPayloadReferences.ISSUE_PULL_REQUEST,
    GitHubPayloadReferences.COMMENT_BODY,
    GitHubPayloadReferences.SENDER_LOGIN,
  ],
  PULL_REQUEST_CORE: [
    GitHubPayloadReferences.REPOSITORY_FULL_NAME,
    GitHubPayloadReferences.PULL_REQUEST_NUMBER,
    GitHubPayloadReferences.PULL_REQUEST_BODY,
    GitHubPayloadReferences.PULL_REQUEST_BASE_REF,
    GitHubPayloadReferences.SENDER_LOGIN,
  ],
} as const satisfies Record<string, readonly IntegrationWebhookPayloadReference[]>;

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

const GitHubWebhookPermissionRequirements = {
  CHECKS_READ: {
    permission: "checks",
    access: "read",
  },
  CONTENTS_READ: {
    permission: "contents",
    access: "read",
  },
  ISSUES_READ: {
    permission: "issues",
    access: "read",
  },
  PULL_REQUESTS_READ: {
    permission: "pull_requests",
    access: "read",
  },
} as const satisfies Record<string, IntegrationWebhookTriggerProviderPermissionRequirement>;

function createGitHubWebhookRequirements(
  eventType: string,
  permission: IntegrationWebhookTriggerProviderPermissionRequirement,
): IntegrationWebhookTriggerRequirements {
  return {
    anyOf: [
      {
        event: eventType,
        permissions: [permission],
      },
    ],
  };
}

function createGitHubWebhookEventDefinition(input: {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category: string;
  requirements: IntegrationWebhookTriggerRequirements;
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
    requirements: input.requirements,
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
    requirements: createGitHubWebhookRequirements(
      "issues",
      GitHubWebhookPermissionRequirements.ISSUES_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.ISSUE_CORE,
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createInvocationTokenParameter(["issue", "body"]),
      GitHubRepositoryParameter,
      GitHubAuthorParameter,
    ],
  }),
  createGitHubWebhookEventDefinition({
    eventType: "github.issues.closed",
    providerEventType: "issues",
    displayName: "Issue closed",
    category: "Issues",
    requirements: createGitHubWebhookRequirements(
      "issues",
      GitHubWebhookPermissionRequirements.ISSUES_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.ISSUE_CORE,
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
    requirements: createGitHubWebhookRequirements(
      "issues",
      GitHubWebhookPermissionRequirements.ISSUES_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.ISSUE_CORE,
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
    requirements: createGitHubWebhookRequirements(
      "issue_comment",
      GitHubWebhookPermissionRequirements.ISSUES_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.ISSUE_COMMENT_CORE,
    conversationKeyOptions: [
      GitHubIssueConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createInvocationTokenParameter(["comment", "body"]),
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
    requirements: createGitHubWebhookRequirements(
      "pull_request",
      GitHubWebhookPermissionRequirements.PULL_REQUESTS_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.PULL_REQUEST_CORE,
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createInvocationTokenParameter(["pull_request", "body"]),
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
    requirements: createGitHubWebhookRequirements(
      "pull_request",
      GitHubWebhookPermissionRequirements.PULL_REQUESTS_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.PULL_REQUEST_CORE,
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
    requirements: createGitHubWebhookRequirements(
      "pull_request",
      GitHubWebhookPermissionRequirements.PULL_REQUESTS_READ,
    ),
    payloadReferences: GitHubPayloadReferenceGroups.PULL_REQUEST_CORE,
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
    requirements: createGitHubWebhookRequirements(
      "pull_request",
      GitHubWebhookPermissionRequirements.PULL_REQUESTS_READ,
    ),
    payloadReferences: [
      ...GitHubPayloadReferenceGroups.PULL_REQUEST_CORE,
      GitHubPayloadReferences.PULL_REQUEST_HEAD_REF,
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
    requirements: createGitHubWebhookRequirements(
      "pull_request_review",
      GitHubWebhookPermissionRequirements.PULL_REQUESTS_READ,
    ),
    payloadReferences: [
      GitHubPayloadReferences.REPOSITORY_FULL_NAME,
      GitHubPayloadReferences.PULL_REQUEST_NUMBER,
      GitHubPayloadReferences.PULL_REQUEST_BASE_REF,
      GitHubPayloadReferences.REVIEW_BODY,
      GitHubPayloadReferences.SENDER_LOGIN,
    ],
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createInvocationTokenParameter(["review", "body"]),
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
    requirements: createGitHubWebhookRequirements(
      "pull_request_review_comment",
      GitHubWebhookPermissionRequirements.PULL_REQUESTS_READ,
    ),
    payloadReferences: [
      GitHubPayloadReferences.REPOSITORY_FULL_NAME,
      GitHubPayloadReferences.PULL_REQUEST_NUMBER,
      GitHubPayloadReferences.PULL_REQUEST_BASE_REF,
      GitHubPayloadReferences.COMMENT_BODY,
      GitHubPayloadReferences.SENDER_LOGIN,
    ],
    conversationKeyOptions: [
      GitHubPullRequestConversationKeyOption,
      GitHubRepositoryConversationKeyOption,
    ],
    parameters: [
      createInvocationTokenParameter(["comment", "body"]),
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
    requirements: createGitHubWebhookRequirements(
      "push",
      GitHubWebhookPermissionRequirements.CONTENTS_READ,
    ),
    payloadReferences: [GitHubPayloadReferences.REPOSITORY_FULL_NAME, GitHubPayloadReferences.REF],
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
    requirements: createGitHubWebhookRequirements(
      "check_suite",
      GitHubWebhookPermissionRequirements.CHECKS_READ,
    ),
    payloadReferences: [GitHubPayloadReferences.REPOSITORY_FULL_NAME],
    conversationKeyOptions: [GitHubRepositoryConversationKeyOption],
    parameters: [GitHubRepositoryParameter],
  }),
];
