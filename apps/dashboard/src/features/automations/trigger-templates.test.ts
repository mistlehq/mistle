import { describe, expect, it } from "vitest";

import { getTriggerTemplateById } from "./trigger-templates.js";

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
    expect(template.inputTemplate).toContain(
      "{{payload.pull_request.number | default: payload.issue.number}}",
    );
    expect(template.inputTemplate).toContain("{{webhookEvent.eventType}}");
    expect(template.inputTemplate).toContain('{{payload.pull_request.base.ref | default: ""}}');
    expect(template.inputTemplate).toContain('{{payload.pull_request.head.ref | default: ""}}');
    expect(template.inputTemplate).toContain('{{payload.comment.body | default: ""}}');
    expect(template.inputTemplate).toContain('{{payload.pull_request.body | default: ""}}');
    expect(template.inputTemplate).not.toContain("{{payload.pull_request.html_url}}");
    expect(template.inputTemplate).not.toContain("{{payload.pull_request.title}}");
    expect(template.inputTemplate).not.toContain("{{payload.action}}");
    expect(template.instructions).toContain("`gh` CLI");
    expect(template.instructions).toContain("routing data only");
    expect(template.instructions).toContain("`gh pr view`");
    expect(template.instructions).toContain("`gh pr diff`");
    expect(template.instructions).toContain("`gh pr comment`");
    expect(template.instructions).toContain("`gh pr review`");
    expect(template.instructions).toContain("`gh api`");
    expect(template.conversationKeyTemplate).toBe(
      "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number | default: payload.issue.number}}",
    );
  });
});
