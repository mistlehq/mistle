import { describe, expect, it } from "vitest";

import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubGroupedConnectionLabel,
  GitHubWebhookSourceId,
} from "./webhook-automation-test-fixtures.js";
import {
  groupWebhookAutomationEventOptions,
  resolveSelectedWebhookAutomationEventOptions,
  resolveWebhookAutomationTriggerPickerState,
} from "./webhook-automation-trigger-picker-state.js";

const WebhookEventOptions = [
  createGithubIssueCommentCreatedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
  createGithubPullRequestOpenedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
] as const;

describe("webhook automation trigger picker state", () => {
  it("groups available triggers by integration connection label", () => {
    expect(groupWebhookAutomationEventOptions(WebhookEventOptions)).toEqual([
      {
        connectionLabel: "GitHub - GitHub Engineering",
        logoKey: "github",
        items: [WebhookEventOptions[0], WebhookEventOptions[1]],
      },
    ]);
  });

  it("preserves missing selected triggers as synthetic unavailable entries", () => {
    expect(
      resolveSelectedWebhookAutomationEventOptions({
        eventOptions: WebhookEventOptions,
        selectedTriggerIds: [
          createWebhookAutomationTriggerId({
            webhookSourceId: GitHubWebhookSourceId,
            eventType: "github.push.deleted",
          }),
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.push.deleted",
        }),
        availability: "missing_integration",
        eventType: "github.push.deleted",
      }),
    ]);
  });

  it("disables the picker with profile-scoped helper copy when a disabled state is provided", () => {
    expect(
      resolveWebhookAutomationTriggerPickerState({
        disabledState: {
          reason:
            "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
          variant: "default",
        },
        eventOptions: WebhookEventOptions,
        hasConnectedIntegrations: true,
        selectedTriggerIds: [],
      }),
    ).toEqual({
      availableEventOptions: [],
      groupedAvailableEventOptions: [],
      disabled: true,
      helperMessage:
        "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      helperVariant: "default",
      inputPlaceholder: "No events available",
    });
  });
});
