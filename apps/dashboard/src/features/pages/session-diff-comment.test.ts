import { describe, expect, it } from "vitest";

import {
  buildPendingSessionDiffCommentPromptBlock,
  buildPendingSessionDiffCommentSummaryLabel,
  buildSessionComposerPrompt,
  capturePendingSessionDiffCommentAnchor,
  reconcilePendingSessionDiffComments,
  type PendingSessionDiffComment,
} from "./session-diff-comment.js";
import { parseSessionDiffPatch } from "./session-diff-panel-model.js";

function createTestComment(
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

const ReconciliationBasePatch = [
  "diff --git a/example.ts b/example.ts",
  "index 1111111..2222222 100644",
  "--- a/example.ts",
  "+++ b/example.ts",
  "@@ -10,3 +10,4 @@",
  ' const first = "alpha";',
  ' const second = "beta";',
  '+const inserted = "new";',
  ' const third = "gamma";',
].join("\n");

const ReconciliationStalePatch = ReconciliationBasePatch.replace(
  ' const third = "gamma";',
  ' const third = "delta";',
);

function createAnchoredComment(input: {
  body: string;
  id: string;
  lineNumber: number;
  patch: string;
}): PendingSessionDiffComment {
  const parsedPatch = parseSessionDiffPatch(input.patch);
  if (parsedPatch.kind !== "parsed") {
    throw new Error("Expected parsed reconciliation patch.");
  }

  const fileDiff = parsedPatch.files[0];
  if (fileDiff === undefined) {
    throw new Error("Expected story file diff.");
  }
  const anchor = capturePendingSessionDiffCommentAnchor({
    fileDiff,
    lineNumber: input.lineNumber,
    side: "additions",
  });
  if (anchor === null) {
    throw new Error("Expected anchored diff comment.");
  }

  return {
    id: input.id,
    anchor,
    body: input.body,
    filePath: "example.ts",
    lineNumber: input.lineNumber,
    repositoryPath: "/workspace/mistle",
    side: "additions",
    status: {
      kind: "current",
    },
  };
}

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
          createTestComment({
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

  it("serializes multiple diff comments in order when the composer text is blank", () => {
    expect(
      buildSessionComposerPrompt({
        composerText: "   ",
        pendingDiffComments: [
          createTestComment({
            body: "Request change",
            filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
            id: "comment_1",
          }),
          {
            ...createTestComment({
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

  it("relocates a pending comment when the same line moves within the diff", () => {
    const anchoredComment = createAnchoredComment({
      body: "Keep this line as-is.",
      id: "comment_1",
      lineNumber: 12,
      patch: [
        "diff --git a/example.ts b/example.ts",
        "index 1111111..2222222 100644",
        "--- a/example.ts",
        "+++ b/example.ts",
        "@@ -10,3 +10,3 @@",
        ' const first = "alpha";',
        ' const second = "beta";',
        ' const third = "gamma";',
      ].join("\n"),
    });
    const parsedPatch = parseSessionDiffPatch(ReconciliationBasePatch);
    if (parsedPatch.kind !== "parsed") {
      throw new Error("Expected parsed reconciliation patch.");
    }

    const reconciledComments = reconcilePendingSessionDiffComments({
      comments: [anchoredComment],
      currentRepositoryPath: "/workspace/mistle",
      fileDiffs: parsedPatch.files,
    });
    const reconciledComment = reconciledComments[0];
    if (reconciledComment === undefined) {
      throw new Error("Expected reconciled comment.");
    }

    expect(reconciledComment.lineNumber).toBe(13);
    expect(reconciledComment.status).toEqual({
      kind: "relocated",
      previousLineNumber: 12,
    });
  });

  it("marks a pending comment as stale when the anchored line disappears", () => {
    const anchoredComment = createAnchoredComment({
      body: "This should be reviewed again.",
      id: "comment_1",
      lineNumber: 13,
      patch: ReconciliationBasePatch,
    });
    const parsedPatch = parseSessionDiffPatch(ReconciliationStalePatch);
    if (parsedPatch.kind !== "parsed") {
      throw new Error("Expected parsed stale patch.");
    }

    const reconciledComments = reconcilePendingSessionDiffComments({
      comments: [anchoredComment],
      currentRepositoryPath: "/workspace/mistle",
      fileDiffs: parsedPatch.files,
    });
    const reconciledComment = reconciledComments[0];
    if (reconciledComment === undefined) {
      throw new Error("Expected reconciled comment.");
    }

    expect(reconciledComment.status).toEqual({
      kind: "stale",
    });
  });
});
