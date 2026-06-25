import {
  buildPendingSessionBlueprintCommentPromptBlock,
  type PendingSessionBlueprintComment,
} from "../session-blueprint-comment.js";
import {
  buildPendingSessionDiffCommentPromptBlock,
  type PendingSessionDiffComment,
} from "../session-diff-comment.js";

export function buildSessionComposerPrompt(input: {
  composerText: string;
  pendingBlueprintComments: readonly PendingSessionBlueprintComment[];
  pendingDiffComments: readonly PendingSessionDiffComment[];
}): string {
  const promptSections = [
    ...input.pendingBlueprintComments.map((comment) =>
      buildPendingSessionBlueprintCommentPromptBlock(comment),
    ),
    ...input.pendingDiffComments.map((comment) =>
      buildPendingSessionDiffCommentPromptBlock(comment),
    ),
  ];
  const trimmedComposerText = input.composerText.trim();

  if (trimmedComposerText.length > 0) {
    promptSections.push(trimmedComposerText);
  }

  return promptSections.join("\n\n");
}
