import { describe, expect, it } from "vitest";

import {
  buildPendingSessionDiffCommentPromptBlock,
  buildPendingSessionDiffCommentSummaryLabel,
  buildSessionComposerPrompt,
} from "./session-diff-comment.js";

describe("session-diff-comment", () => {
  it("formats summary labels with the comment count", () => {
    expect(buildPendingSessionDiffCommentSummaryLabel(1)).toBe("1 comment");
    expect(buildPendingSessionDiffCommentSummaryLabel(3)).toBe("3 comments");
  });

  it("builds a single diff comment block with trimmed body text", () => {
    expect(
      buildPendingSessionDiffCommentPromptBlock({
        body: "  Request change  ",
        filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
        lineNumber: 10,
        side: "additions",
      }),
    ).toBe(
      [
        "Review comment on `apps/dashboard/src/features/pages/session-workbench-page.tsx` line R10:",
        "",
        "Request change",
      ].join("\n"),
    );
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

  it("serializes multiple diff comments in order when the composer text is blank", () => {
    expect(
      buildSessionComposerPrompt({
        composerText: "   ",
        pendingDiffComments: [
          {
            id: "comment_1",
            body: "Request change",
            filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
            lineNumber: 10,
            side: "additions",
          },
          {
            id: "comment_2",
            body: "Use the shared overflow tooltip here.",
            filePath: "apps/dashboard/src/features/pages/session-diff-panel.tsx",
            lineNumber: 4,
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
