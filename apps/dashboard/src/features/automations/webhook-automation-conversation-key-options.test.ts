import { SlackBrowserDefinition } from "@mistle/integrations-definitions/browser";
import { describe, expect, it } from "vitest";

import {
  GitHubPullRequestConversationKeyTemplate,
  resolveCommonWebhookAutomationConversationKeyOptions,
} from "./webhook-automation-conversation-key-options.js";
import {
  createWebhookAutomationEventOption,
  createWebhookAutomationTriggerId,
} from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubWebhookSourceId,
} from "./webhook-automation-test-fixtures.js";

const SlackWebhookSourceId = "iws_slack";
const SlackConnectionId = "icn_slack";
const GitHubIssueCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
const GitHubPullRequestOpenedTriggerId = createWebhookAutomationTriggerId({
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

  return createWebhookAutomationEventOption({
    eventDefinition,
    webhookSourceId: SlackWebhookSourceId,
    connectionId: SlackConnectionId,
    connectionLabel: "Slack Engineering",
    logoKey: "slack",
  });
}

describe("resolveCommonWebhookAutomationConversationKeyOptions", () => {
  it("keeps Slack thread grouping available across message and reaction triggers", () => {
    const options = resolveCommonWebhookAutomationConversationKeyOptions({
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
    const options = resolveCommonWebhookAutomationConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      triggerParameterValues: {
        [GitHubIssueCommentCreatedTriggerId]: {
          target: "exists",
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
    const options = resolveCommonWebhookAutomationConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      triggerParameterValues: {
        [GitHubIssueCommentCreatedTriggerId]: {
          target: "not_exists",
        },
      },
    });

    expect(options.map((option) => option.id)).toEqual(["repository"]);
  });

  it("does not add GitHub pull request grouping when the comment target is unconstrained", () => {
    const options = resolveCommonWebhookAutomationConversationKeyOptions({
      selectedEventOptions: [
        createGithubPullRequestOpenedEventOption({
          id: GitHubPullRequestOpenedTriggerId,
        }),
        createGithubIssueCommentCreatedEventOption({
          id: GitHubIssueCommentCreatedTriggerId,
        }),
      ],
      triggerParameterValues: {},
    });

    expect(options.map((option) => option.id)).toEqual(["repository"]);
  });
});
