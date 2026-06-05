import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { WebhookTriggerEventPicker } from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
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
  StorySlackEventOptions,
} from "./webhook-trigger-story-fixtures.js";

function StoryHarness(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventParameterRules?: WebhookTriggerEventParameterRuleMap;
  eventOptions: readonly WebhookTriggerEventOption[];
  error?: string;
  showGitHubTeamSyncError?: boolean;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createWebhookTriggerStoryQueryClient(
      input.showGitHubTeamSyncError === true
        ? { githubTeamResources: StoryGitHubTeamResourcesSyncFailed }
        : undefined,
    ),
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

export const Default: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryPullRequestReviewCommentCreatedTriggerId],
    eventParameterRules: {
      [StoryPullRequestReviewCommentCreatedTriggerId]: {
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
    selectedEventIds: [StoryPullRequestOpenedTriggerId],
    eventParameterRules: {
      [StoryPullRequestOpenedTriggerId]: {
        author: isNotRule("dependabot"),
        baseBranch: isRule("main"),
        repository: isRule("mistlehq/platform"),
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
    selectedEventIds: [StoryPullRequestReviewRequestedTriggerId],
    eventParameterRules: {
      [StoryPullRequestReviewRequestedTriggerId]: {
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
    selectedEventIds: [StoryPullRequestReviewRequestedTriggerId],
    eventParameterRules: {
      [StoryPullRequestReviewRequestedTriggerId]: {
        requestedTeam: isRule("platform"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
    showGitHubTeamSyncError: true,
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
    selectedEventIds: [StoryPushDeletedTriggerId],
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
    selectedEventIds: [StoryIssueCommentCreatedTriggerId],
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
    selectedEventIds: [StorySlackAppMentionTriggerId],
    eventParameterRules: {
      [StorySlackAppMentionTriggerId]: {
        channel: isRule("C_ALERTS_001"),
      },
    },
    eventOptions: StorySlackEventOptions,
  },
};

export const SlackUnavailableArchivedChannelSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StorySlackConnectionId,
    selectedEventIds: [StorySlackAppMentionTriggerId],
    eventParameterRules: {
      [StorySlackAppMentionTriggerId]: {
        channel: isRule("C_ARCHIVED_001"),
      },
    },
    eventOptions: StorySlackEventOptions,
  },
};

export const AddSecondEvent: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: StoryGitHubConnectionId,
    selectedEventIds: [StoryIssueCommentCreatedTriggerId],
    eventParameterRules: {
      [StoryIssueCommentCreatedTriggerId]: {
        invocationToken: containsTokenRule("@mistlebot"),
      },
    },
    eventOptions: StoryGitHubEventOptions,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const addTriggerInput = canvas.getByPlaceholderText("Add event");

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
