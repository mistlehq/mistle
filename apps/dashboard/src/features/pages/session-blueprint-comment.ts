import type { DesignerBlueprintItem } from "../designer/designer-blueprint-schema.js";

export type PendingSessionBlueprintComment = {
  body: string;
  id: string;
  itemDescription?: string | undefined;
  itemId: string;
  itemKindLabel: string;
  itemLabel: string;
};

export type PendingSessionBlueprintCommentInput = Omit<PendingSessionBlueprintComment, "id">;

export function buildPendingSessionBlueprintCommentSummaryLabel(commentCount: number): string {
  return `${commentCount} blueprint comment${commentCount === 1 ? "" : "s"}`;
}

export function buildPendingSessionBlueprintCommentSummaryTitle(
  comments: readonly PendingSessionBlueprintComment[],
): string {
  return comments
    .map(
      (comment) =>
        `${comment.itemKindLabel}: ${comment.itemLabel} (${comment.itemId})\n${comment.body}`,
    )
    .join("\n\n");
}

export function buildPendingSessionBlueprintCommentPromptBlock(
  comment: PendingSessionBlueprintComment,
): string {
  const itemContext = [
    `Item id: \`${comment.itemId}\``,
    `Item kind: ${comment.itemKindLabel}`,
    `Item label: ${comment.itemLabel}`,
    ...(comment.itemDescription === undefined
      ? []
      : [`Item description: ${comment.itemDescription}`]),
  ];

  return [
    `Designer blueprint comment on \`${comment.itemId}\` (${comment.itemKindLabel}: ${comment.itemLabel}):`,
    "",
    ...itemContext,
    "",
    comment.body.trim(),
  ].join("\n");
}

export function createPendingSessionBlueprintCommentInput(input: {
  body: string;
  item: DesignerBlueprintItem;
  itemKindLabel: string;
  itemLabel: string;
}): PendingSessionBlueprintCommentInput {
  return {
    body: input.body,
    ...(input.item.description === undefined ? {} : { itemDescription: input.item.description }),
    itemId: input.item.id,
    itemKindLabel: input.itemKindLabel,
    itemLabel: input.itemLabel,
  };
}
