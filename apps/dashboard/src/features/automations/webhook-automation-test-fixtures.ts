import { GitHubCloudDefinition } from "@mistle/integrations-definitions";

import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-types.js";
import { createWebhookAutomationEventOption } from "./webhook-automation-option-builders.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import type {
  WebhookAutomationListEvent,
  WebhookAutomationListItem,
  WebhookAutomationListIssue,
} from "./webhook-automations-types.js";

export const GitHubConnectionId = "icn_01kkk1g84mfetvga8a4b853k27";
export const GitHubWebhookSourceId = "iws_01kkk1g84mfetvga8a4b853k27";
export const GitHubConnectionLabel = "GitHub Engineering";
export const GitHubGroupedConnectionLabel = "GitHub - GitHub Engineering";
export const RepoMaintainerSandboxProfileId = "sbp_01kkk1mbmxfetvga8kcmw612jj";

export function createGitHubEventOption(input: {
  eventType: string;
  overrides?: Partial<WebhookAutomationEventOption>;
}): WebhookAutomationEventOption {
  const eventDefinition = GitHubCloudDefinition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === input.eventType,
  );

  if (eventDefinition === undefined) {
    throw new Error(`Missing GitHub event definition for '${input.eventType}'.`);
  }

  return {
    ...createWebhookAutomationEventOption({
      eventDefinition,
      webhookSourceId: GitHubWebhookSourceId,
      connectionId: GitHubConnectionId,
      connectionLabel: GitHubConnectionLabel,
      logoKey: "github",
    }),
    ...input.overrides,
  };
}

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

export function createWebhookAutomationListIssue(
  overrides?: Partial<WebhookAutomationListIssue>,
): WebhookAutomationListIssue {
  return {
    code: "MISSING_TARGET_METADATA",
    message:
      "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
    ...overrides,
  };
}

export function createDefaultWebhookAutomationListStoryItems(): readonly WebhookAutomationListItemViewModel[] {
  return [
    createWebhookAutomationListItemViewModel({
      id: "aut_01jps7k2z2v3qj4k9m0n1p2q3r",
      name: "GitHub pushes to repo triage",
      targetName: "Repo Maintainer",
      events: [
        createWebhookAutomationListEvent({
          label: "CI completed",
          logoKey: "github",
        }),
        createWebhookAutomationListEvent({
          label: "Pull request opened",
          logoKey: "github",
        }),
        createWebhookAutomationListEvent({
          label: "Issue comment created",
          logoKey: "github",
        }),
      ],
      updatedAtLabel: "6 min ago",
      enabled: true,
    }),
    createWebhookAutomationListItemViewModel({
      id: "aut_01jps7mhvgc0p7e01b4z4r7c0m",
      name: "Stripe payouts incident intake",
      targetName: "Finance Investigator",
      events: [
        createWebhookAutomationListEvent({
          label: "Payout failed",
        }),
      ],
      updatedAtLabel: "1 day ago",
      enabled: false,
    }),
    createWebhookAutomationListItemViewModel({
      id: "aut_01jps7qxbxw6kxdj1r9s9v8y2h",
      name: "Legacy GitHub escalation",
      targetName: "Incident Commander",
      events: [
        createWebhookAutomationListEvent({
          label: "github.push.deleted",
          unavailable: true,
        }),
        createWebhookAutomationListEvent({
          label: "Pull request opened",
          logoKey: "github",
        }),
      ],
      updatedAtLabel: "3 days ago",
      enabled: true,
    }),
  ];
}

export function createRowLevelIssueWebhookAutomationListItemViewModel(): WebhookAutomationListItemViewModel {
  return createWebhookAutomationListItemViewModel({
    id: "aut_01jps82rc4z62qy0m7zdb8h5qn",
    name: "Retired metadata triage",
    targetName: "Incident Commander",
    issue: createWebhookAutomationListIssue(),
    events: [
      createWebhookAutomationListEvent({
        label: "issue_comment.created",
        unavailable: true,
      }),
    ],
    updatedAtLabel: "3 days ago",
    enabled: true,
  });
}

export function createGithubIssueCommentCreatedEventOption(
  overrides?: Partial<WebhookAutomationEventOption>,
): WebhookAutomationEventOption {
  return createGitHubEventOption({
    eventType: "github.issue_comment.created",
    ...(overrides === undefined ? {} : { overrides }),
  });
}

export function createGithubPullRequestOpenedEventOption(
  overrides?: Partial<WebhookAutomationEventOption>,
): WebhookAutomationEventOption {
  return createGitHubEventOption({
    eventType: "github.pull_request.opened",
    ...(overrides === undefined ? {} : { overrides }),
  });
}
