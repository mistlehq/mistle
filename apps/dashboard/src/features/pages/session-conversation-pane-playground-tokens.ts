import type React from "react";

export type ConversationPaneFixtureId =
  | "mixed"
  | "default"
  | "exploring"
  | "sequential"
  | "thinking"
  | "plan"
  | "generic";

export const TailwindSpacingScale = {
  "gap-0": "0px",
  "gap-px": "1px",
  "gap-0.5": "2px",
  "gap-1": "4px",
  "gap-1.5": "6px",
  "gap-2": "8px",
  "gap-2.5": "10px",
  "gap-3": "12px",
  "gap-3.5": "14px",
  "gap-4": "16px",
  "gap-5": "20px",
  "gap-6": "24px",
  "gap-7": "28px",
  "gap-8": "32px",
  "gap-9": "36px",
  "gap-10": "40px",
  "gap-11": "44px",
  "gap-12": "48px",
  "gap-14": "56px",
  "gap-16": "64px",
  "gap-20": "80px",
} as const;

export type TailwindSpacingToken = keyof typeof TailwindSpacingScale;

export const TailwindLeadingScale = {
  "leading-none": "1",
  "leading-tight": "1.25",
  "leading-snug": "1.375",
  "leading-normal": "1.5",
  "leading-relaxed": "1.625",
  "leading-loose": "2",
  "leading-3": "0.75rem",
  "leading-4": "1rem",
  "leading-5": "1.25rem",
  "leading-6": "1.5rem",
  "leading-7": "1.75rem",
  "leading-8": "2rem",
} as const;

export type TailwindLeadingToken = keyof typeof TailwindLeadingScale;

export const TailwindSpacingTokenOptions = Object.keys(
  TailwindSpacingScale,
) as TailwindSpacingToken[];
export const TailwindLeadingTokenOptions = Object.keys(
  TailwindLeadingScale,
) as TailwindLeadingToken[];

export function getTailwindSpacingValue(token: TailwindSpacingToken): string {
  return TailwindSpacingScale[token];
}

export function formatTailwindSpacingToken(token: TailwindSpacingToken): string {
  return `${token} (${getTailwindSpacingValue(token)})`;
}

export function getTailwindLeadingValue(token: TailwindLeadingToken): string {
  return TailwindLeadingScale[token];
}

export function formatTailwindLeadingToken(token: TailwindLeadingToken): string {
  return `${token} (${getTailwindLeadingValue(token)})`;
}

export type MeasurementHighlightTarget =
  | "turn-group"
  | "turn-content"
  | "assistant-block"
  | "assistant-stack"
  | "assistant-to-semantic"
  | "assistant-width"
  | "user-bubble"
  | "user-content"
  | "semantic-group"
  | "semantic-header"
  | "semantic-summary"
  | "semantic-title"
  | "semantic-indent"
  | "semantic-row"
  | "semantic-row-leading"
  | "semantic-detail"
  | "semantic-item-gap"
  | "semantic-item-detail-gap"
  | "semantic-output-margin"
  | "semantic-output-padding"
  | "semantic-output-stack"
  | "semantic-output-leading"
  | "plan-gap"
  | "plan-indent"
  | "plan-step-gap";

export type ConversationPaneLayoutPlaygroundControls = {
  fixture: ConversationPaneFixtureId;
  turnGapPx: TailwindSpacingToken;
  turnContentGapPx: TailwindSpacingToken;
  assistantBlockGapPx: TailwindSpacingToken;
  semanticStackGapPx: TailwindSpacingToken;
  assistantToSemanticGapPx: TailwindSpacingToken;
  assistantMaxWidthCh: number;
  userBubbleMaxWidthRem: number;
  userMessageGapPx: TailwindSpacingToken;
  semanticGroupGapPx: TailwindSpacingToken;
  semanticGroupHeaderGapPx: TailwindSpacingToken;
  semanticGroupSummaryGapPx: TailwindSpacingToken;
  semanticGroupTitleGapPx: TailwindSpacingToken;
  semanticGroupIndentPx: TailwindSpacingToken;
  semanticGroupRowGapPx: TailwindSpacingToken;
  semanticGroupRowLeading: TailwindLeadingToken;
  semanticGroupDetailLeading: TailwindLeadingToken;
  semanticGroupItemGapPx: TailwindSpacingToken;
  semanticGroupItemDetailGapPx: TailwindSpacingToken;
  semanticGroupOutputPaddingPx: TailwindSpacingToken;
  semanticGroupOutputStackGapPx: TailwindSpacingToken;
  semanticGroupOutputLeading: TailwindLeadingToken;
  planEntryGapPx: TailwindSpacingToken;
  planIndentPx: TailwindSpacingToken;
  planStepGapPx: TailwindSpacingToken;
};

export type ConversationPanePlaygroundStyle = React.CSSProperties & {
  "--chat-plan-entry-gap"?: string;
  "--chat-plan-entry-indent"?: string;
  "--chat-plan-step-gap"?: string;
  "--chat-semantic-group-content-gap"?: string;
  "--chat-semantic-group-gap"?: string;
  "--chat-semantic-group-header-gap"?: string;
  "--chat-semantic-group-indent"?: string;
  "--chat-semantic-group-item-detail-gap"?: string;
  "--chat-semantic-group-item-gap"?: string;
  "--chat-semantic-group-detail-leading"?: string;
  "--chat-semantic-group-output-leading"?: string;
  "--chat-semantic-group-output-padding"?: string;
  "--chat-semantic-group-output-stack-gap"?: string;
  "--chat-semantic-group-row-gap"?: string;
  "--chat-semantic-group-row-leading"?: string;
  "--chat-semantic-group-summary-gap"?: string;
  "--chat-semantic-group-title-gap"?: string;
  "--chat-thread-assistant-block-gap"?: string;
  "--chat-thread-assistant-max-width"?: string;
  "--chat-thread-assistant-to-semantic-gap"?: string;
  "--chat-thread-padding-top"?: string;
  "--chat-thread-semantic-stack-gap"?: string;
  "--chat-thread-turn-content-gap"?: string;
  "--chat-thread-turn-gap"?: string;
  "--chat-user-message-content-gap"?: string;
  "--chat-user-message-max-width"?: string;
};
