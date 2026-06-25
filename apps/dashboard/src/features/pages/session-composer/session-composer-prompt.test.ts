import { describe, expect, it } from "vitest";

import { buildPendingSessionDiffCommentPromptBlock } from "../session-diff-comment.js";
import type { PendingSessionDiffComment } from "../session-diff-comment.js";
import { buildSessionComposerPrompt } from "./session-composer-prompt.js";

function createTestDiffComment(
  input: Pick<PendingSessionDiffComment, "body" | "filePath" | "id">,
): PendingSessionDiffComment {
  return {
    ...input,
    anchor: {
      lineText: "test line",
      nextLineText: null,
      previousLineText: null,
    },
    lineNumber: 10,
    repositoryPath: "/workspace/mistle",
    side: "additions",
    status: {
      kind: "current",
    },
  };
}

describe("session-composer-prompt", () => {
  it("serializes pending diff comments ahead of freeform composer text", () => {
    expect(
      buildSessionComposerPrompt({
        composerText: "Please fix this in the next patch.",
        pendingBlueprintComments: [],
        pendingDiffComments: [
          createTestDiffComment({
            body: "Request change",
            filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
            id: "comment_1",
          }),
        ],
      }),
    ).toBe(
      [
        buildPendingSessionDiffCommentPromptBlock({
          body: "Request change",
          filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
          lineNumber: 10,
          side: "additions",
        }),
        "Please fix this in the next patch.",
      ].join("\n\n"),
    );
  });

  it("serializes pending blueprint comments with Designer-specific context", () => {
    expect(
      buildSessionComposerPrompt({
        composerText: "Please revise the workflow.",
        pendingBlueprintComments: [
          {
            body: "  This step should ask for missing severity first.  ",
            id: "blueprint-comment-1",
            itemDescription: "Determine type, priority, owner, and missing information.",
            itemId: "classify-issue",
            itemKindLabel: "Agent step",
            itemLabel: "Classify issue",
          },
        ],
        pendingDiffComments: [],
      }),
    ).toBe(
      [
        [
          "Designer blueprint comment on `classify-issue` (Agent step: Classify issue):",
          "",
          "Item id: `classify-issue`",
          "Item kind: Agent step",
          "Item label: Classify issue",
          "Item description: Determine type, priority, owner, and missing information.",
          "",
          "This step should ask for missing severity first.",
        ].join("\n"),
        "Please revise the workflow.",
      ].join("\n\n"),
    );
  });

  it("serializes multiple diff comments in order when the composer text is blank", () => {
    expect(
      buildSessionComposerPrompt({
        composerText: "   ",
        pendingBlueprintComments: [],
        pendingDiffComments: [
          createTestDiffComment({
            body: "Request change",
            filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
            id: "comment_1",
          }),
          {
            ...createTestDiffComment({
              body: "Use the shared overflow tooltip here.",
              filePath: "apps/dashboard/src/features/pages/session-diff-panel.tsx",
              id: "comment_2",
            }),
            lineNumber: 4,
          },
        ],
      }),
    ).toBe(
      [
        buildPendingSessionDiffCommentPromptBlock({
          body: "Request change",
          filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
          lineNumber: 10,
          side: "additions",
        }),
        buildPendingSessionDiffCommentPromptBlock({
          body: "Use the shared overflow tooltip here.",
          filePath: "apps/dashboard/src/features/pages/session-diff-panel.tsx",
          lineNumber: 4,
          side: "additions",
        }),
      ].join("\n\n"),
    );
  });
});
