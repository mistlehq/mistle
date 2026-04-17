import { describe, expect, it } from "vitest";

import { resolveWebhookAutomationFormState } from "./webhook-automation-form-state.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubWebhookSourceId,
} from "./webhook-automation-test-fixtures.js";

describe("resolveWebhookAutomationFormState", () => {
  it("derives the selected connection id when all selected triggers share a connection", () => {
    const selectedTriggerId = createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedTriggerIds: [selectedTriggerId],
      conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      triggerIdsError: undefined,
    });

    expect(state.selectedConnectionId).toBe(GitHubConnectionId);
    expect(state.hasSelectedTrigger).toBe(true);
  });

  it("suppresses the special unavailable-trigger message from the header", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [],
      selectedTriggerIds: ["missing-source::missing.event"],
      conversationKeyTemplate: "",
      triggerIdsError: "Trigger is unavailable for the selected sandbox profile.",
    });

    expect(state.triggerHeaderMessage).toBeUndefined();
  });

  it("keeps other trigger errors visible in the header", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "",
      triggerIdsError: "Please add a trigger",
    });

    expect(state.triggerHeaderMessage).toBe("Please add a trigger");
  });

  it("derives the selected grouping label from the supported conversation key options", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      triggerIdsError: undefined,
    });

    expect(state.selectedConversationGroupingLabel).toBe("Issue");
  });

  it("builds agent instruction tokens from the selected trigger payload references", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [
        createGithubIssueCommentCreatedEventOption(),
        createGithubPullRequestOpenedEventOption(),
      ],
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "",
      triggerIdsError: undefined,
    });

    expect(
      state.agentInstructionTokens.some((token) => token.path === "payload.comment.body"),
    ).toBe(true);
    expect(
      state.agentInstructionTokens.some((token) => token.path === "payload.pull_request.title"),
    ).toBe(false);
  });
});
