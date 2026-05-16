import { describe, expect, it } from "vitest";

import {
  groupWebhookTriggerEventOptions,
  resolveSelectedWebhookTriggerEventOptions,
  resolveWebhookTriggerEventPickerState,
} from "./webhook-trigger-event-picker-state.js";
import { createWebhookTriggerEventId } from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubGroupedConnectionLabel,
  GitHubWebhookSourceId,
} from "./webhook-trigger-test-fixtures.js";

const WebhookEventOptions = [
  createGithubIssueCommentCreatedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
  createGithubPullRequestOpenedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
] as const;

describe("webhook trigger trigger picker state", () => {
  it("groups available triggers by integration connection label", () => {
    expect(groupWebhookTriggerEventOptions(WebhookEventOptions)).toEqual([
      {
        connectionLabel: "GitHub - GitHub Engineering",
        logoKey: "github",
        items: [WebhookEventOptions[0], WebhookEventOptions[1]],
      },
    ]);
  });

  it("preserves missing selected triggers as synthetic unavailable entries", () => {
    expect(
      resolveSelectedWebhookTriggerEventOptions({
        eventOptions: WebhookEventOptions,
        selectedEventIds: [
          createWebhookTriggerEventId({
            webhookSourceId: GitHubWebhookSourceId,
            eventType: "github.push.deleted",
          }),
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: createWebhookTriggerEventId({
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
      resolveWebhookTriggerEventPickerState({
        disabledState: {
          reason:
            "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
          variant: "default",
        },
        eventOptions: WebhookEventOptions,
        hasConnectedIntegrations: true,
        selectedEventIds: [],
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
