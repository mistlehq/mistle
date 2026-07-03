import { SlackBrowserDefinition } from "@mistle/integrations-definitions/browser";
import { describe, expect, it } from "vitest";

import {
  GitHubPullRequestConversationKeyTemplate,
  resolveCommonWebhookTriggerConversationKeyOptions,
} from "./webhook-trigger-conversation-key-options.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import {
  createWebhookTriggerEventOption,
  createWebhookTriggerEventId,
} from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubWebhookSourceId,
} from "./webhook-trigger-test-fixtures.js";

const SlackWebhookSourceId = "iws_slack";
const SlackConnectionId = "icn_slack";
const GitHubIssueCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
const GitHubPullRequestOpenedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});

function createSlackEventOption(eventType: string) {
  const eventDefinition = SlackBrowserDefinition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (eventDefinition === undefined) {
    throw new Error(`Missing Slack event definition for '${eventType}'.`);
  }

  return createWebhookTriggerEventOption({
    eventDefinition,
    webhookSourceId: SlackWebhookSourceId,
    connectionId: SlackConnectionId,
    connectionLabel: "Slack Engineering",
    logoKey: "slack",
  });
}

describe("resolveCommonWebhookTriggerConversationKeyOptions", () => {
  it("keeps Slack thread grouping available across message and reaction triggers", () => {
    const options = resolveCommonWebhookTriggerConversationKeyOptions({
      selectedEventOptions: [
        createSlackEventOption("slack:message"),
        createSlackEventOption("slack:reaction_added"),
        createSlackEventOption("slack:reaction_removed"),
      ],
    });

    expect(options).toEqual([
      {
        id: "channel",
        label: "Channel",
        description: "Events from the same Slack channel go to the same conversation.",
        template: "slack:channel:{{payload.event.channel}}",
      },
      {
        id: "thread",
        label: "Thread",
        description: "Events from the same Slack thread go to the same conversation.",
        template: "slack:thread:{{payload.event.channel}}:{{payload.event.mistle_thread_root_ts}}",
      },
    ]);
  });

  it("keeps GitHub pull request grouping available for pull request comments", () => {
    const options = resolveCommonWebhookTriggerConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      eventParameterRules: {
        [GitHubIssueCommentCreatedTriggerId]: {
          target: {
            operator: WebhookTriggerEventParameterRuleOperators.EXISTS,
            value: "exists",
          },
        },
      },
    });

    expect(options).toEqual([
      {
        id: "pull-request",
        label: "Pull request",
        description: "Events from the same pull request go to the same conversation.",
        template: GitHubPullRequestConversationKeyTemplate,
      },
      {
        id: "repository",
        label: "Repository",
        description: "Events from the same repository go to the same conversation.",
        template: "{{payload.repository.full_name}}",
      },
    ]);
  });

  it("does not add GitHub pull request grouping for issue comments", () => {
    const options = resolveCommonWebhookTriggerConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      eventParameterRules: {
        [GitHubIssueCommentCreatedTriggerId]: {
          target: {
            operator: WebhookTriggerEventParameterRuleOperators.NOT_EXISTS,
            value: "not_exists",
          },
        },
      },
    });

    expect(options.map((option) => option.id)).toEqual(["repository"]);
  });

  it("does not add GitHub pull request grouping when the comment target is unconstrained", () => {
    const options = resolveCommonWebhookTriggerConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      eventParameterRules: {},
    });

    expect(options.map((option) => option.id)).toEqual(["repository"]);
  });

  it("does not add GitHub pull request grouping when the comment target rule is cleared", () => {
    const options = resolveCommonWebhookTriggerConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      eventParameterRules: {
        [GitHubIssueCommentCreatedTriggerId]: {
          target: {
            operator: WebhookTriggerEventParameterRuleOperators.EXISTS,
            value: "",
          },
        },
      },
    });

    expect(options.map((option) => option.id)).toEqual(["repository"]);
  });
});
