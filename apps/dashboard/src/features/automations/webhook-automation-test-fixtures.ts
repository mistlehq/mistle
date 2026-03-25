import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-types.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import type {
  WebhookAutomationListEvent,
  WebhookAutomationListItem,
} from "./webhook-automations-types.js";

export const GitHubConnectionId = "icn_01kkk1g84mfetvga8a4b853k27";
export const GitHubConnectionLabel = "GitHub Engineering";
export const GitHubGroupedConnectionLabel = "GitHub - GitHub Engineering";
export const RepoMaintainerSandboxProfileId = "sbp_01kkk1mbmxfetvga8kcmw612jj";

export function createWebhookAutomationListEvent(
  overrides?: Partial<WebhookAutomationListEvent>,
): WebhookAutomationListEvent {
  return {
    label: "Push",
    ...overrides,
  };
}

export function createWebhookAutomationListItem(
  overrides?: Partial<WebhookAutomationListItem>,
): WebhookAutomationListItem {
  return {
    id: "aut_123",
    name: "Repo triage",
    enabled: true,
    targetName: "Repo Maintainer",
    events: [createWebhookAutomationListEvent()],
    updatedAt: "2026-03-05T00:00:00.000Z",
    ...overrides,
  };
}

export function createWebhookAutomationListItemViewModel(
  overrides?: Partial<WebhookAutomationListItemViewModel>,
): WebhookAutomationListItemViewModel {
  return {
    id: "aut_01",
    name: "Repo triage",
    enabled: true,
    targetName: "Repo Maintainer",
    events: [createWebhookAutomationListEvent()],
    updatedAtLabel: "6 min ago",
    ...overrides,
  };
}

export function createGithubIssueCommentCreatedEventOption(
  overrides?: Partial<WebhookAutomationEventOption>,
): WebhookAutomationEventOption {
  return {
    id: createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
      eventType: "github.issue_comment.created",
    }),
    eventType: "github.issue_comment.created",
    connectionId: GitHubConnectionId,
    connectionLabel: GitHubConnectionLabel,
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
    conversationKeyOptions: [
      {
        id: "issue",
        label: "Issue",
        description: "Events from the same issue go to the same conversation.",
        template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      },
      {
        id: "repository",
        label: "Repository",
        description: "Events from the same repository go to the same conversation.",
        template: "{{payload.repository.full_name}}",
      },
    ],
    parameters: [
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
    ],
    ...overrides,
  };
}

export function createGithubPullRequestOpenedEventOption(
  overrides?: Partial<WebhookAutomationEventOption>,
): WebhookAutomationEventOption {
  return {
    id: createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
      eventType: "github.pull_request.opened",
    }),
    eventType: "github.pull_request.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: GitHubConnectionLabel,
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
    conversationKeyOptions: [
      {
        id: "pull-request",
        label: "Pull request",
        description: "Events from the same pull request go to the same conversation.",
        template: "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
      },
      {
        id: "repository",
        label: "Repository",
        description: "Events from the same repository go to the same conversation.",
        template: "{{payload.repository.full_name}}",
      },
    ],
    parameters: [
      {
        id: "author",
        label: "author",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["sender", "login"],
        prefix: "by",
        placeholder: "Any author",
      },
    ],
    ...overrides,
  };
}
