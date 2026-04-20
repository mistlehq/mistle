import type { FileDiffMetadata } from "@pierre/diffs/react";

export type PendingSessionDiffCommentAnchor = {
  lineText: string;
  previousLineText: string | null;
  nextLineText: string | null;
};

export type PendingSessionDiffCommentStatus =
  | {
      kind: "current";
    }
  | {
      kind: "relocated";
      previousLineNumber: number;
    }
  | {
      kind: "stale";
    };

export type PendingSessionDiffComment = {
  id: string;
  anchor: PendingSessionDiffCommentAnchor;
  body: string;
  filePath: string;
  lineNumber: number;
  repositoryPath: string | null;
  side: "additions" | "deletions";
  status: PendingSessionDiffCommentStatus;
};

export type PendingSessionDiffCommentInput = Omit<PendingSessionDiffComment, "id" | "status"> & {
  status?: PendingSessionDiffCommentStatus;
};

type DiffFileSideLine = {
  lineNumber: number;
  text: string;
};

function getDiffCommentSideLabel(side: PendingSessionDiffComment["side"]): "L" | "R" {
  return side === "additions" ? "R" : "L";
}

function getDiffFileSideLines(
  fileDiff: FileDiffMetadata,
  side: PendingSessionDiffComment["side"],
): readonly DiffFileSideLine[] {
  const lines: DiffFileSideLine[] = [];

  for (const hunk of fileDiff.hunks) {
    let additionLineNumber = hunk.additionStart;
    let deletionLineNumber = hunk.deletionStart;
    let additionLineIndex = hunk.additionLineIndex;
    let deletionLineIndex = hunk.deletionLineIndex;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let index = 0; index < content.lines; index += 1) {
          const additionText = fileDiff.additionLines[additionLineIndex];
          const deletionText = fileDiff.deletionLines[deletionLineIndex];
          if (additionText === undefined || deletionText === undefined) {
            throw new Error("Diff context line metadata is incomplete.");
          }

          if (side === "additions") {
            lines.push({
              lineNumber: additionLineNumber,
              text: additionText,
            });
          } else {
            lines.push({
              lineNumber: deletionLineNumber,
              text: deletionText,
            });
          }
          additionLineNumber += 1;
          additionLineIndex += 1;
          deletionLineNumber += 1;
          deletionLineIndex += 1;
        }

        continue;
      }

      for (let index = 0; index < content.deletions; index += 1) {
        if (side === "deletions") {
          const deletionText = fileDiff.deletionLines[deletionLineIndex];
          if (deletionText === undefined) {
            throw new Error("Diff deletion line metadata is incomplete.");
          }

          lines.push({
            lineNumber: deletionLineNumber,
            text: deletionText,
          });
        }
        deletionLineNumber += 1;
        deletionLineIndex += 1;
      }

      for (let index = 0; index < content.additions; index += 1) {
        if (side === "additions") {
          const additionText = fileDiff.additionLines[additionLineIndex];
          if (additionText === undefined) {
            throw new Error("Diff addition line metadata is incomplete.");
          }

          lines.push({
            lineNumber: additionLineNumber,
            text: additionText,
          });
        }
        additionLineNumber += 1;
        additionLineIndex += 1;
      }
    }
  }

  return lines;
}

function scorePendingSessionDiffCommentCandidate(
  anchor: PendingSessionDiffCommentAnchor,
  candidate: {
    nextLineText: string | null;
    previousLineText: string | null;
    text: string;
  },
): number {
  if (candidate.text !== anchor.lineText) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 2;
  if (anchor.previousLineText === candidate.previousLineText) {
    score += 1;
  }
  if (anchor.nextLineText === candidate.nextLineText) {
    score += 1;
  }

  return score;
}

function resolvePendingSessionDiffCommentLine(
  fileDiff: FileDiffMetadata,
  side: PendingSessionDiffComment["side"],
  lineNumber: number,
): {
  line: DiffFileSideLine;
  nextLineText: string | null;
  previousLineText: string | null;
} | null {
  const sideLines = getDiffFileSideLines(fileDiff, side);
  const lineIndex = sideLines.findIndex((line) => line.lineNumber === lineNumber);
  if (lineIndex === -1) {
    return null;
  }

  const line = sideLines[lineIndex];
  if (line === undefined) {
    throw new Error("Resolved diff line is missing.");
  }

  return {
    line,
    nextLineText: sideLines[lineIndex + 1]?.text ?? null,
    previousLineText: sideLines[lineIndex - 1]?.text ?? null,
  };
}

export function capturePendingSessionDiffCommentAnchor(input: {
  fileDiff: FileDiffMetadata;
  lineNumber: number;
  side: PendingSessionDiffComment["side"];
}): PendingSessionDiffCommentAnchor | null {
  const resolvedLine = resolvePendingSessionDiffCommentLine(
    input.fileDiff,
    input.side,
    input.lineNumber,
  );
  if (resolvedLine === null) {
    return null;
  }

  return {
    lineText: resolvedLine.line.text,
    nextLineText: resolvedLine.nextLineText,
    previousLineText: resolvedLine.previousLineText,
  };
}

export function countPendingSessionDiffCommentsRequiringReview(
  comments: readonly PendingSessionDiffComment[],
): number {
  return comments.filter((comment) => comment.status.kind === "stale").length;
}

export function reconcilePendingSessionDiffComments(input: {
  comments: readonly PendingSessionDiffComment[];
  currentRepositoryPath: string | null;
  fileDiffs: readonly FileDiffMetadata[];
}): readonly PendingSessionDiffComment[] {
  let changed = false;

  const nextComments: PendingSessionDiffComment[] = input.comments.map((comment) => {
    if (comment.repositoryPath !== input.currentRepositoryPath) {
      if (comment.status.kind === "stale") {
        return comment;
      }

      changed = true;
      return {
        ...comment,
        status: {
          kind: "stale",
        },
      };
    }

    const fileDiff = input.fileDiffs.find((candidateFileDiff) => {
      const rawFilePath = candidateFileDiff.name || candidateFileDiff.prevName || "";
      const candidateFilePath =
        rawFilePath.startsWith("a/") || rawFilePath.startsWith("b/")
          ? rawFilePath.slice(2)
          : rawFilePath;
      return candidateFilePath === comment.filePath;
    });
    if (fileDiff === undefined) {
      if (comment.status.kind === "stale") {
        return comment;
      }

      changed = true;
      return {
        ...comment,
        status: {
          kind: "stale",
        },
      };
    }

    const currentLine = resolvePendingSessionDiffCommentLine(
      fileDiff,
      comment.side,
      comment.lineNumber,
    );
    const exactMatchScore =
      currentLine === null
        ? Number.NEGATIVE_INFINITY
        : scorePendingSessionDiffCommentCandidate(comment.anchor, {
            nextLineText: currentLine.nextLineText,
            previousLineText: currentLine.previousLineText,
            text: currentLine.line.text,
          });
    if (exactMatchScore >= 3) {
      if (comment.status.kind === "current") {
        return comment;
      }

      changed = true;
      return {
        ...comment,
        status: {
          kind: "current",
        },
      };
    }

    const sideLines = getDiffFileSideLines(fileDiff, comment.side);
    let bestCandidate: {
      lineNumber: number;
      score: number;
    } | null = null;

    for (let index = 0; index < sideLines.length; index += 1) {
      const candidateLine = sideLines[index];
      if (candidateLine === undefined) {
        continue;
      }

      const candidateScore = scorePendingSessionDiffCommentCandidate(comment.anchor, {
        nextLineText: sideLines[index + 1]?.text ?? null,
        previousLineText: sideLines[index - 1]?.text ?? null,
        text: candidateLine.text,
      });

      if (
        bestCandidate === null ||
        candidateScore > bestCandidate.score ||
        (candidateScore === bestCandidate.score &&
          Math.abs(candidateLine.lineNumber - comment.lineNumber) <
            Math.abs(bestCandidate.lineNumber - comment.lineNumber))
      ) {
        bestCandidate = {
          lineNumber: candidateLine.lineNumber,
          score: candidateScore,
        };
      }
    }

    if (bestCandidate !== null && bestCandidate.score >= 3) {
      const nextAnchor = capturePendingSessionDiffCommentAnchor({
        fileDiff,
        lineNumber: bestCandidate.lineNumber,
        side: comment.side,
      });
      if (nextAnchor === null) {
        return comment;
      }

      changed = true;
      const nextStatus: PendingSessionDiffCommentStatus =
        bestCandidate.lineNumber === comment.lineNumber
          ? {
              kind: "current",
            }
          : {
              kind: "relocated",
              previousLineNumber: comment.lineNumber,
            };
      return {
        ...comment,
        anchor: nextAnchor,
        lineNumber: bestCandidate.lineNumber,
        status: nextStatus,
      };
    }

    if (comment.status.kind === "stale") {
      return comment;
    }

    changed = true;
    return {
      ...comment,
      status: {
        kind: "stale",
      },
    };
  });

  return changed ? nextComments : input.comments;
}

export function formatPendingSessionDiffCommentLineLabel(input: {
  lineNumber: number;
  side: PendingSessionDiffComment["side"];
}): string {
  return `${getDiffCommentSideLabel(input.side)}${input.lineNumber}`;
}

export function buildPendingSessionDiffCommentSummaryLabel(commentCount: number): string {
  return `${commentCount} comment${commentCount === 1 ? "" : "s"}`;
}

export function buildPendingSessionDiffCommentSummaryTitle(
  comments: readonly PendingSessionDiffComment[],
): string {
  return comments
    .map((comment) => {
      const statusSuffix =
        comment.status.kind === "current"
          ? ""
          : comment.status.kind === "relocated"
            ? ""
            : " (needs review)";
      return `${comment.filePath} ${formatPendingSessionDiffCommentLineLabel(comment)}${statusSuffix}\n${comment.body}`;
    })
    .join("\n\n");
}

export function buildPendingSessionDiffCommentPromptBlock(
  comment: Pick<PendingSessionDiffComment, "body" | "filePath" | "lineNumber" | "side">,
): string {
  return [
    `Review comment on \`${comment.filePath}\` line ${formatPendingSessionDiffCommentLineLabel(comment)}:`,
    "",
    comment.body.trim(),
  ].join("\n");
}

export function buildSessionComposerPrompt(input: {
  composerText: string;
  pendingDiffComments: readonly PendingSessionDiffComment[];
}): string {
  const promptSections = input.pendingDiffComments.map((comment) =>
    buildPendingSessionDiffCommentPromptBlock(comment),
  );
  const trimmedComposerText = input.composerText.trim();

  if (trimmedComposerText.length > 0) {
    promptSections.push(trimmedComposerText);
  }

  return promptSections.join("\n\n");
}
