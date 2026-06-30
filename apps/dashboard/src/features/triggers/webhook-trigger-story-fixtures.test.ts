import { describe, expect, it } from "vitest";

import {
  StoryGitHubEventOptions,
  StoryIssueCommentCreatedTriggerId,
} from "./webhook-trigger-story-fixtures.js";

describe("webhook trigger story fixtures", () => {
  it("makes the mixed GitHub actor allowlist story exercise actor groups and sets", () => {
    const eventOption = StoryGitHubEventOptions.find(
      (option) => option.id === StoryIssueCommentCreatedTriggerId,
    );

    expect(eventOption).toBeDefined();
    expect(eventOption?.resourceRelationshipDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "org",
        }),
        expect.objectContaining({
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "team",
        }),
      ]),
    );
  });
});
