import { describe, expect, it } from "vitest";

import { getTriggerTemplateById } from "./trigger-templates.js";

describe("trigger templates", () => {
  it("defines the GitHub PR review template for pull request lifecycle review events", () => {
    const template = getTriggerTemplateById("github-pr-review");

    expect(template.kind).toBe("trigger");
    if (template.kind !== "trigger") {
      throw new Error("Expected GitHub PR review template to be a webhook trigger template.");
    }

    expect(template.logoKey).toBe("github");
    expect(template.eventTypes).toEqual([
      "github.pull_request.opened",
      "github.pull_request.reopened",
      "github.pull_request.synchronize",
    ]);
    expect(template.inputTemplate).toContain("{{payload.repository.full_name}}");
    expect(template.inputTemplate).toContain("{{payload.pull_request.number}}");
    expect(template.inputTemplate).toContain("{{webhookEvent.eventType}}");
    expect(template.inputTemplate).toContain("{{payload.pull_request.head.ref}}");
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
      "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
    );
  });
});
