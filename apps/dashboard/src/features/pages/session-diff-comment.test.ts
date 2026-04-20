import { describe, expect, it } from "vitest";

import {
  buildPendingSessionDiffCommentBadgeLabel,
  buildPendingSessionDiffCommentPromptBlock,
  buildPendingSessionDiffCommentSummaryLabel,
  buildSessionComposerPrompt,
} from "./session-diff-comment.js";

describe("session-diff-comment", () => {
  it("formats badge labels with the file name and side-aware line label", () => {
    expect(
      buildPendingSessionDiffCommentBadgeLabel({
        filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
        lineNumber: 10,
        side: "additions",
      }),
    ).toBe("session-workbench-page.tsx:R10");
  });

  it("formats summary labels with the comment count", () => {
    expect(buildPendingSessionDiffCommentSummaryLabel(1)).toBe("1 comment");
    expect(buildPendingSessionDiffCommentSummaryLabel(3)).toBe("3 comments");
  });

  it("serializes pending diff comments ahead of freeform composer text", () => {
    expect(
      buildSessionComposerPrompt({
        composerText: "Please fix this in the next patch.",
        pendingDiffComments: [
          {
            id: "comment_1",
            body: "Request change",
            filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
            lineNumber: 10,
            side: "additions",
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
        "Please fix this in the next patch.",
      ].join("\n\n"),
    );
  });
});
