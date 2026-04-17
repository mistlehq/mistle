import { describe, expect, it } from "vitest";

import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import { createGithubIssueCommentCreatedEventOption } from "./webhook-automation-test-fixtures.js";

describe("resolveConversationKeyFieldOptions", () => {
  it("does not inject an unsupported current conversation grouping option", () => {
    const fieldOptions = resolveConversationKeyFieldOptions({
      selectedEventOptions: [createGithubIssueCommentCreatedEventOption()],
      currentTemplate: "{{payload.unsupported}}",
    });

    expect(fieldOptions.hasUnsupportedCurrentTemplate).toBe(true);
    expect(fieldOptions.selectedTemplate).toBe("");
    expect(
      fieldOptions.options.some((option) => option.label === "Current setting (unsupported)"),
    ).toBe(false);
  });
});
