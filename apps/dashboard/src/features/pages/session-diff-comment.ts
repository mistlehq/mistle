export type PendingSessionDiffComment = {
  id: string;
  body: string;
  filePath: string;
  lineNumber: number;
  side: "additions" | "deletions";
};

export type PendingSessionDiffCommentInput = Omit<PendingSessionDiffComment, "id">;

function getDiffCommentSideLabel(side: PendingSessionDiffComment["side"]): "L" | "R" {
  return side === "additions" ? "R" : "L";
}

function getFileName(filePath: string): string {
  const pathSegments = filePath.split("/");
  return pathSegments[pathSegments.length - 1] ?? filePath;
}

export function formatPendingSessionDiffCommentLineLabel(input: {
  lineNumber: number;
  side: PendingSessionDiffComment["side"];
}): string {
  return `${getDiffCommentSideLabel(input.side)}${input.lineNumber}`;
}

export function buildPendingSessionDiffCommentBadgeLabel(
  comment: Pick<PendingSessionDiffComment, "filePath" | "lineNumber" | "side">,
): string {
  return `${getFileName(comment.filePath)}:${formatPendingSessionDiffCommentLineLabel(comment)}`;
}

export function buildPendingSessionDiffCommentBadgeTitle(
  comment: PendingSessionDiffComment,
): string {
  return `${comment.filePath} ${formatPendingSessionDiffCommentLineLabel(comment)}\n\n${comment.body}`;
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
