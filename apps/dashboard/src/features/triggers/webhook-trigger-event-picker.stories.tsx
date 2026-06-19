import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { WebhookTriggerEventPicker } from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import { createWebhookTriggerEventConditionId } from "./webhook-trigger-option-builders.js";
import {
  containsTokenRule,
  createWebhookTriggerStoryQueryClient,
  isNotRule,
  isRule,
  StoryGitHubConnectionId,
  StoryGitHubEventOptions,
  StoryGitHubTeamResourcesSyncFailed,
  StoryGitHubWebhookSourceId,
  StoryIssueCommentCreatedTriggerId,
  StoryPullRequestOpenedTriggerId,
  StoryPullRequestReviewCommentCreatedTriggerId,
  StoryPullRequestReviewRequestedTriggerId,
  StoryPushDeletedTriggerId,
  StorySlackAppMentionTriggerId,
  StorySlackConnectionId,
  StorySlackChannelResourcesSyncing,
  StorySlackEventOptions,
  StoryWasenderApiConnectionId,
  StoryWasenderApiEventOptions,
  StoryWasenderApiMessagesReceivedTriggerId,
  StoryWasenderApiMessagesUpsertTriggerId,
  StoryWhapiChannelPostTriggerId,
  StoryWhapiConnectionId,
  StoryWhapiEventOptions,
  StoryWhapiMessagesPatchTriggerId,
  StoryWhapiMessagesPostTriggerId,
  StoryWhapiStatusesPostTriggerId,
  StoryWhapiUsersPostTriggerId,
} from "./webhook-trigger-story-fixtures.js";

const StoryIssueCommentCreatedConditionId = conditionId(StoryIssueCommentCreatedTriggerId);
const StoryPullRequestOpenedConditionId = conditionId(StoryPullRequestOpenedTriggerId);
const StoryPullRequestReviewRequestedConditionId = conditionId(
  StoryPullRequestReviewRequestedTriggerId,
);
const StoryPullRequestReviewCommentCreatedConditionId = conditionId(
  StoryPullRequestReviewCommentCreatedTriggerId,
);
const StoryPushDeletedConditionId = conditionId(StoryPushDeletedTriggerId);
const StorySlackAppMentionConditionId = conditionId(StorySlackAppMentionTriggerId);

function conditionId(eventOptionId: string, index = 0): string {
  return createWebhookTriggerEventConditionId({ eventOptionId, index });
}

function isAnyOfRule(values: readonly string[]) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value: "",
    values: [...values],
  };
}

function StoryHarness(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventParameterRules?: WebhookTriggerEventParameterRuleMap;
  eventOptions: readonly WebhookTriggerEventOption[];
  error?: string;
  showGitHubTeamSyncError?: boolean;
  showSlackChannelSyncing?: boolean;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createWebhookTriggerStoryQueryClient({
      ...(input.showGitHubTeamSyncError === true
        ? { githubTeamResources: StoryGitHubTeamResourcesSyncFailed }
        : {}),
      ...(input.showSlackChannelSyncing === true
        ? { slackChannelResources: StorySlackChannelResourcesSyncing }
        : {}),
    }),
  );
  const [selectedEventIds, setSelectedEventIds] = useState([...input.selectedEventIds]);
  const [eventParameterRules, setEventParameterRules] = useState(input.eventParameterRules ?? {});

  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-full max-w-6xl px-6 py-8">
        <WebhookTriggerEventPicker
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onEventParameterRuleChange={({ triggerId, parameterId, rule }) => {
            setEventParameterRules((currentValues) => ({
              ...currentValues,
              [triggerId]: {
                ...(currentValues[triggerId] ?? {}),
                [parameterId]: rule,
              },
            }));
          }}
          onEventParameterRulesChange={({ triggerId, rules }) => {
            setEventParameterRules((currentValues) => ({
              ...currentValues,
              [triggerId]: rules,
            }));
          }}
          onValueChange={setSelectedEventIds}
          selectedConnectionId={input.selectedConnectionId}
          selectedEventIds={selectedEventIds}
          eventParameterRules={eventParameterRules}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/Event/EventPicker",
  component: StoryHarness,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

async function findVisibleButtonByName(
  queries: ReturnType<typeof within>,
  name: string,
): Promise<HTMLElement> {
  let visibleButton: HTMLElement | undefined;

  await waitFor(() => {
    visibleButton = queries
      .getAllByRole("button", { name })
      .find((button: HTMLElement) => button.getClientRects().length > 0);
    if (visibleButton === undefined) {
      throw new Error(`Expected visible button named '${name}'.`);
    }
  });

  if (visibleButton === undefined) {
    throw new Error(`Expected visible button named '${name}'.`);
  }

  return visibleButton;
}

export const Default: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPullRequestReviewCommentCreatedConditionId],
    eventParameterRules: {
      [StoryPullRequestReviewCommentCreatedConditionId]: {
        invocationToken: containsTokenRule("@mistlebot"),
        commenter: isRule("octocat"),
        baseBranch: isRule("main"),
        repository: isRule("mistlehq/platform"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
  },
};

export const NegativeEqualityParameters: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPullRequestOpenedConditionId],
    eventParameterRules: {
      [StoryPullRequestOpenedConditionId]: {
        author: isNotRule("dependabot"),
        baseBranch: isRule("main"),
        repository: isRule("mistlehq/platform"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
  },
};

export const GitHubMultipleResourceParameters: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPullRequestOpenedConditionId],
    eventParameterRules: {
      [StoryPullRequestOpenedConditionId]: {
        repository: isAnyOfRule(["mistlehq/platform", "mistlehq/dashboard"]),
        author: isAnyOfRule(["octocat", "hubot"]),
        baseBranch: isAnyOfRule(["main", "release"]),
      },
    },
    eventOptions: StoryGitHubEventOptions,
  },
};

export const GitHubReviewRequestTeamTarget: Story = {
  name: "GitHub review request team target",
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPullRequestReviewRequestedConditionId],
    eventParameterRules: {
      [StoryPullRequestReviewRequestedConditionId]: {
        requestedTeam: isRule("platform"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
  },
};

export const GitHubReviewRequestTeamSyncFailed: Story = {
  name: "GitHub review request team sync failed",
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPullRequestReviewRequestedConditionId],
    eventParameterRules: {
      [StoryPullRequestReviewRequestedConditionId]: {
        requestedTeam: isRule("platform"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
    showGitHubTeamSyncError: true,
  },
};

export const SlackChannelRefreshFooter: Story = {
  name: "Slack channel refresh footer",
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StorySlackConnectionId,
    selectedEventIds: [StorySlackAppMentionConditionId],
    eventParameterRules: {
      [StorySlackAppMentionConditionId]: {
        channel: isAnyOfRule(["C_ENG_001"]),
      },
    },
    eventOptions: StorySlackEventOptions,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(await body.findByDisplayValue("#engineering"));
    await findVisibleButtonByName(body, "Refresh channels");
  },
};

export const SlackChannelRefreshingFooter: Story = {
  name: "Slack channel refreshing footer",
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StorySlackConnectionId,
    selectedEventIds: [StorySlackAppMentionConditionId],
    eventParameterRules: {
      [StorySlackAppMentionConditionId]: {
        channel: isAnyOfRule(["C_ENG_001"]),
      },
    },
    eventOptions: StorySlackEventOptions,
    showSlackChannelSyncing: true,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(await body.findByDisplayValue("#engineering"));
    await expect(await findVisibleButtonByName(body, "Refresh channels")).toBeDisabled();
    await expect(body.getByText("Refreshing channels")).toBeVisible();
  },
};

export const NoSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [],
    eventOptions: StoryGitHubEventOptions,
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    hasConnectedIntegrations: false,
    selectedConnectionId: "",
    selectedEventIds: [],
    eventOptions: [],
  },
};

export const NoEventsAvailable: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [],
    eventOptions: [],
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPushDeletedConditionId],
    eventOptions: [
      ...StoryGitHubEventOptions,
      {
        id: StoryPushDeletedTriggerId,
        eventType: "github.push.deleted",
        integrationWebhookSourceId: StoryGitHubWebhookSourceId,
        connectionId: StoryGitHubConnectionId,
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

export const WrongProfileSavedEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryIssueCommentCreatedConditionId],
    eventOptions: [
      {
        id: StoryIssueCommentCreatedTriggerId,
        eventType: "github.issue_comment.created",
        integrationWebhookSourceId: StoryGitHubWebhookSourceId,
        connectionId: StoryGitHubConnectionId,
        connectionLabel: "GitHub Engineering",
        label: "Issue comment created",
        category: "GitHub Engineering / Issues",
        logoKey: "github",
        availability: "wrong_profile",
        description: "Event is unavailable for the selected sandbox profile.",
      },
    ],
  },
};

export const SlackAppMentionChannelOnly: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StorySlackConnectionId,
    selectedEventIds: [StorySlackAppMentionConditionId],
    eventParameterRules: {
      [StorySlackAppMentionConditionId]: {
        channel: isAnyOfRule(["C_ALERTS_001"]),
      },
    },
    eventOptions: StorySlackEventOptions,
  },
};

export const SlackAppMentionMultipleChannels: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StorySlackConnectionId,
    selectedEventIds: [StorySlackAppMentionConditionId],
    eventParameterRules: {
      [StorySlackAppMentionConditionId]: {
        channel: isAnyOfRule(["C_ALERTS_001", "C_ENG_001"]),
      },
    },
    eventOptions: StorySlackEventOptions,
  },
};

export const SlackUnavailableArchivedChannelSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StorySlackConnectionId,
    selectedEventIds: [StorySlackAppMentionConditionId],
    eventParameterRules: {
      [StorySlackAppMentionConditionId]: {
        channel: isAnyOfRule(["C_ARCHIVED_001"]),
      },
    },
    eventOptions: StorySlackEventOptions,
  },
};

export const WasenderAPIMessageEvents: Story = {
  name: "WasenderAPI message events",
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryWasenderApiConnectionId,
    selectedEventIds: [
      conditionId(StoryWasenderApiMessagesUpsertTriggerId),
      conditionId(StoryWasenderApiMessagesReceivedTriggerId, 1),
    ],
    eventOptions: StoryWasenderApiEventOptions,
  },
};

export const WhapiWhatsAppEvents: Story = {
  name: "Whapi callback events",
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryWhapiConnectionId,
    selectedEventIds: [
      conditionId(StoryWhapiMessagesPostTriggerId),
      conditionId(StoryWhapiMessagesPatchTriggerId, 1),
      conditionId(StoryWhapiStatusesPostTriggerId, 2),
      conditionId(StoryWhapiChannelPostTriggerId, 3),
      conditionId(StoryWhapiUsersPostTriggerId, 4),
    ],
    eventOptions: StoryWhapiEventOptions,
  },
};

export const AddSecondEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryIssueCommentCreatedConditionId],
    eventParameterRules: {
      [StoryIssueCommentCreatedConditionId]: {
        invocationToken: containsTokenRule("@mistlebot"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const addTriggerInput = canvas.getByPlaceholderText("Add condition");

    await userEvent.click(addTriggerInput);
    await userEvent.click(await canvas.findByRole("option", { name: "Pull request opened" }));

    await expect(
      canvas.getByRole("button", { name: "Remove Issue comment created trigger" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Remove Pull request opened trigger" }),
    ).toBeVisible();
  },
};
