import { describe, expect, it } from "vitest";

import {
  getTriggerTemplateById,
  resolveTriggerTemplateEventOptionIds,
} from "./trigger-templates.js";
import { GitHubPullRequestConversationKeyTemplate } from "./webhook-automation-conversation-key-options.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubWebhookSourceId,
} from "./webhook-automation-test-fixtures.js";

const OtherGitHubWebhookSourceId = "iws_other_github";

describe("trigger templates", () => {
  it("defines the GitHub PR review template for opened pull requests and review request comments", () => {
    const template = getTriggerTemplateById("github-pr-review");

    expect(template.kind).toBe("trigger");
    if (template.kind !== "trigger") {
      throw new Error("Expected GitHub PR review template to be a webhook trigger template.");
    }

    expect(template.logoKey).toBe("github");
    expect(template.eventTypes).toEqual([
      "github.pull_request.opened",
      "github.issue_comment.created",
    ]);
    expect(template.triggerParameterValuesByEventType).toEqual({
      "github.issue_comment.created": {
        invocationToken: "pr-review",
        target: "exists",
      },
    });
    expect(template.inputTemplate).toContain("{{payload.repository.full_name}}");
    expect(template.inputTemplate).toContain("{{webhookEvent.eventType}}");
    expect(template.inputTemplate).toContain("{% if payload.pull_request %}");
    expect(template.inputTemplate).toContain("Pull request opened:");
    expect(template.inputTemplate).toContain("{{payload.pull_request.number}}");
    expect(template.inputTemplate).toContain("{{payload.pull_request.base.ref}}");
    expect(template.inputTemplate).toContain("{{payload.pull_request.head.ref}}");
    expect(template.inputTemplate).toContain('{{payload.pull_request.body | default: ""}}');
    expect(template.inputTemplate).toContain("PR review requested from issue comment:");
    expect(template.inputTemplate).toContain("{{payload.issue.number}}");
    expect(template.inputTemplate).toContain("{{payload.comment.body}}");
    expect(template.inputTemplate).not.toContain("{{payload.pull_request.html_url}}");
    expect(template.inputTemplate).not.toContain("{{payload.pull_request.title}}");
    expect(template.inputTemplate).not.toContain("{{payload.action}}");
    expect(template.instructions).toContain("# GitHub PR Review");
    expect(template.instructions).toContain("Use live PR state.");
    expect(template.instructions).toContain("routing data only");
    expect(template.instructions).toContain("`gh pr view`");
    expect(template.instructions).toContain("`gh pr diff`");
    expect(template.instructions).toContain("Read repo-local review, test, contribution");
    expect(template.instructions).toContain("reconstruct the review scope");
    expect(template.instructions).toContain("Trace each changed behavior");
    expect(template.instructions).toContain("entrypoint -> validation/parsing -> dispatch");
    expect(template.instructions).toContain("Use source, executable checks, current docs");
    expect(template.instructions).toContain("Lead with findings.");
    expect(template.instructions).toContain("no blocking correctness issues were found");
    expect(template.instructions).toContain("If verification fails");
    expect(template.instructions).toContain(
      "whether it appears caused by the PR or by the environment",
    );
    expect(template.instructions).toContain("proof gaps or residual risk");
    expect(template.instructions).toContain("`gh pr comment`");
    expect(template.instructions).toContain("`gh api`");
    expect(template.instructions).not.toContain("Review the pull request for correctness");
    expect(template.conversationKeyTemplate).toBe(GitHubPullRequestConversationKeyTemplate);
  });

  it("resolves template trigger ids only when every event is available from one webhook source", () => {
    const template = getTriggerTemplateById("github-pr-review");
    if (template.kind !== "trigger") {
      throw new Error("Expected GitHub PR review template to be a webhook trigger template.");
    }

    expect(
      resolveTriggerTemplateEventOptionIds({
        template,
        eventOptions: [
          createGithubPullRequestOpenedEventOption(),
          createGithubIssueCommentCreatedEventOption(),
        ],
      }),
    ).toEqual([
      createWebhookAutomationTriggerId({
        webhookSourceId: GitHubWebhookSourceId,
        eventType: "github.pull_request.opened",
      }),
      createWebhookAutomationTriggerId({
        webhookSourceId: GitHubWebhookSourceId,
        eventType: "github.issue_comment.created",
      }),
    ]);

    expect(
      resolveTriggerTemplateEventOptionIds({
        template,
        eventOptions: [
          createGithubPullRequestOpenedEventOption(),
          createGithubIssueCommentCreatedEventOption({
            id: createWebhookAutomationTriggerId({
              webhookSourceId: OtherGitHubWebhookSourceId,
              eventType: "github.issue_comment.created",
            }),
            integrationWebhookSourceId: OtherGitHubWebhookSourceId,
          }),
        ],
      }),
    ).toBeNull();
  });
});
