import { describe, expect, it } from "vitest";

import {
  groupWebhookTriggerEventOptions,
  resolveSelectedWebhookTriggerEventOptions,
  resolveWebhookTriggerEventPickerState,
} from "./webhook-trigger-event-picker-state.js";
import {
  createWebhookTriggerEventConditionId,
  createWebhookTriggerEventId,
} from "./webhook-trigger-option-builders.js";
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

function conditionId(eventOptionId: string, index = 0): string {
  return createWebhookTriggerEventConditionId({ eventOptionId, index });
}

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

  it("preserves missing selected conditions as synthetic unavailable entries", () => {
    const eventOptionId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.push.deleted",
    });
    const selectedConditionId = conditionId(eventOptionId);

    expect(
      resolveSelectedWebhookTriggerEventOptions({
        eventOptions: WebhookEventOptions,
        selectedEventIds: [selectedConditionId],
      }),
    ).toEqual([
      expect.objectContaining({
        id: selectedConditionId,
        availability: "missing_integration",
        eventType: "github.push.deleted",
      }),
    ]);
  });

  it("preserves unavailable selected condition metadata", () => {
    const selectedConditionId = conditionId(WebhookEventOptions[0].id);

    expect(
      resolveSelectedWebhookTriggerEventOptions({
        eventOptions: [
          {
            ...WebhookEventOptions[0],
            id: selectedConditionId,
            availability: "wrong_profile",
            description: "Event is unavailable for the selected sandbox profile.",
          },
        ],
        selectedEventIds: [selectedConditionId],
      }),
    ).toEqual([
      expect.objectContaining({
        id: selectedConditionId,
        availability: "wrong_profile",
        description: "Event is unavailable for the selected sandbox profile.",
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
      shouldShowNoAvailableTriggerEventsNotice: false,
    });
  });

  it("shows setup guidance when connected integrations expose no selectable trigger events", () => {
    expect(
      resolveWebhookTriggerEventPickerState({
        eventOptions: [],
        hasConnectedIntegrations: true,
        selectedEventIds: [],
      }),
    ).toEqual({
      availableEventOptions: [],
      groupedAvailableEventOptions: [],
      disabled: true,
      helperMessage: null,
      helperVariant: "default",
      inputPlaceholder: "No events available",
      shouldShowNoAvailableTriggerEventsNotice: true,
    });
  });

  it("keeps selectable trigger events available after all event types have selected conditions", () => {
    expect(
      resolveWebhookTriggerEventPickerState({
        eventOptions: WebhookEventOptions,
        hasConnectedIntegrations: true,
        selectedEventIds: WebhookEventOptions.map((option, index) => conditionId(option.id, index)),
      }),
    ).toMatchObject({
      availableEventOptions: [...WebhookEventOptions],
      disabled: false,
      helperMessage: null,
      inputPlaceholder: "Add condition",
      shouldShowNoAvailableTriggerEventsNotice: false,
    });
  });
});
