import { describe, expect, it } from "vitest";

import {
  buildPendingSessionDiffCommentPromptBlock,
  buildPendingSessionDiffCommentSummaryLabel,
  capturePendingSessionDiffCommentAnchor,
  reconcilePendingSessionDiffComments,
  type PendingSessionDiffComment,
} from "./session-diff-comment.js";
import { parseSessionDiffPatch } from "./session-diff-panel-model.js";

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
