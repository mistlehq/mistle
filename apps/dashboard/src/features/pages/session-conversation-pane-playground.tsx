import { Fragment, useState } from "react";
import type React from "react";

import {
  getPlaygroundChatEntries,
  type SessionConversationPaneStoryArgs,
} from "./session-conversation-pane-playground-fixtures.js";
import {
  TailwindLeadingTokenOptions,
  TailwindSpacingTokenOptions,
  formatTailwindLeadingToken,
  formatTailwindSpacingToken,
  getTailwindLeadingValue,
  getTailwindSpacingValue,
  type ConversationPanePlaygroundStyle,
  type MeasurementHighlightTarget,
} from "./session-conversation-pane-playground-tokens.js";
import { SessionConversationMainContent } from "./session-conversation-pane.js";
import { SessionConversationScrollBehaviorArgType } from "./session-conversation-story-scroll-behavior.js";

function renderMeasurementHud(input: {
  fixture: SessionConversationPaneStoryArgs["fixture"];
  turnGapPx: SessionConversationPaneStoryArgs["turnGapPx"];
  turnContentGapPx: SessionConversationPaneStoryArgs["turnContentGapPx"];
  assistantBlockGapPx: SessionConversationPaneStoryArgs["assistantBlockGapPx"];
  semanticStackGapPx: SessionConversationPaneStoryArgs["semanticStackGapPx"];
  assistantToSemanticGapPx: SessionConversationPaneStoryArgs["assistantToSemanticGapPx"];
  assistantMaxWidthCh: number;
  userBubbleMaxWidthRem: number;
  userMessageGapPx: SessionConversationPaneStoryArgs["userMessageGapPx"];
  semanticGroupGapPx: SessionConversationPaneStoryArgs["semanticGroupGapPx"];
  semanticGroupHeaderGapPx: SessionConversationPaneStoryArgs["semanticGroupHeaderGapPx"];
  semanticGroupSummaryGapPx: SessionConversationPaneStoryArgs["semanticGroupSummaryGapPx"];
  semanticGroupTitleGapPx: SessionConversationPaneStoryArgs["semanticGroupTitleGapPx"];
  semanticGroupIndentPx: SessionConversationPaneStoryArgs["semanticGroupIndentPx"];
  semanticGroupRowGapPx: SessionConversationPaneStoryArgs["semanticGroupRowGapPx"];
  semanticGroupRowLeading: SessionConversationPaneStoryArgs["semanticGroupRowLeading"];
  semanticGroupDetailLeading: SessionConversationPaneStoryArgs["semanticGroupDetailLeading"];
  semanticGroupItemGapPx: SessionConversationPaneStoryArgs["semanticGroupItemGapPx"];
  semanticGroupItemDetailGapPx: SessionConversationPaneStoryArgs["semanticGroupItemDetailGapPx"];
  semanticGroupOutputPaddingPx: SessionConversationPaneStoryArgs["semanticGroupOutputPaddingPx"];
  semanticGroupOutputStackGapPx: SessionConversationPaneStoryArgs["semanticGroupOutputStackGapPx"];
  semanticGroupOutputLeading: SessionConversationPaneStoryArgs["semanticGroupOutputLeading"];
  planEntryGapPx: SessionConversationPaneStoryArgs["planEntryGapPx"];
  planIndentPx: SessionConversationPaneStoryArgs["planIndentPx"];
  planStepGapPx: SessionConversationPaneStoryArgs["planStepGapPx"];
  hoveredTarget: MeasurementHighlightTarget | null;
  onHoverTarget: (target: MeasurementHighlightTarget | null) => void;
}): React.JSX.Element {
  const rows = [
    ["fixture", input.fixture, null],
    ["turnGapPx", formatTailwindSpacingToken(input.turnGapPx), "turn-group"],
    ["turnContentGapPx", formatTailwindSpacingToken(input.turnContentGapPx), "turn-content"],
    [
      "assistantBlockGapPx",
      formatTailwindSpacingToken(input.assistantBlockGapPx),
      "assistant-block",
    ],
    ["semanticStackGapPx", formatTailwindSpacingToken(input.semanticStackGapPx), "assistant-stack"],
    [
      "assistantToSemanticGapPx",
      formatTailwindSpacingToken(input.assistantToSemanticGapPx),
      "assistant-to-semantic",
    ],
    ["assistantMaxWidthCh", `${String(input.assistantMaxWidthCh)}ch`, "assistant-width"],
    ["userBubbleMaxWidthRem", `${String(input.userBubbleMaxWidthRem)}rem`, "user-bubble"],
    ["userMessageGapPx", formatTailwindSpacingToken(input.userMessageGapPx), "user-content"],
    ["semanticGroupGapPx", formatTailwindSpacingToken(input.semanticGroupGapPx), "semantic-group"],
    [
      "semanticGroupHeaderGapPx",
      formatTailwindSpacingToken(input.semanticGroupHeaderGapPx),
      "semantic-header",
    ],
    [
      "semanticGroupSummaryGapPx",
      formatTailwindSpacingToken(input.semanticGroupSummaryGapPx),
      "semantic-summary",
    ],
    [
      "semanticGroupTitleGapPx",
      formatTailwindSpacingToken(input.semanticGroupTitleGapPx),
      "semantic-title",
    ],
    [
      "semanticGroupIndentPx",
      formatTailwindSpacingToken(input.semanticGroupIndentPx),
      "semantic-indent",
    ],
    [
      "semanticGroupRowGapPx",
      formatTailwindSpacingToken(input.semanticGroupRowGapPx),
      "semantic-row",
    ],
    [
      "semanticGroupRowLeading",
      formatTailwindLeadingToken(input.semanticGroupRowLeading),
      "semantic-row-leading",
    ],
    [
      "semanticGroupDetailLeading",
      formatTailwindLeadingToken(input.semanticGroupDetailLeading),
      "semantic-detail",
    ],
    [
      "semanticGroupItemGapPx",
      formatTailwindSpacingToken(input.semanticGroupItemGapPx),
      "semantic-item-gap",
    ],
    [
      "semanticGroupItemDetailGapPx",
      formatTailwindSpacingToken(input.semanticGroupItemDetailGapPx),
      "semantic-item-detail-gap",
    ],
    [
      "semanticGroupOutputPaddingPx",
      formatTailwindSpacingToken(input.semanticGroupOutputPaddingPx),
      "semantic-output-padding",
    ],
    [
      "semanticGroupOutputStackGapPx",
      formatTailwindSpacingToken(input.semanticGroupOutputStackGapPx),
      "semantic-output-stack",
    ],
    [
      "semanticGroupOutputLeading",
      formatTailwindLeadingToken(input.semanticGroupOutputLeading),
      "semantic-output-leading",
    ],
    ["planEntryGapPx", formatTailwindSpacingToken(input.planEntryGapPx), "plan-gap"],
    ["planIndentPx", formatTailwindSpacingToken(input.planIndentPx), "plan-indent"],
    ["planStepGapPx", formatTailwindSpacingToken(input.planStepGapPx), "plan-step-gap"],
  ] as const;

  return (
    <aside className="bg-background/95 text-foreground flex w-56 flex-col gap-3 rounded-xl border p-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-baseline gap-3">
        <p className="font-medium text-xs tracking-[0.18em] uppercase">Measurements</p>
      </div>
      <dl className="flex flex-col gap-1.5 text-xs">
        {rows.map(([label, _value, target]) => {
          const isHovered = target !== null && input.hoveredTarget === target;
          const interactiveProps =
            target === null
              ? {}
              : {
                  onMouseEnter: () => {
                    input.onHoverTarget(target);
                  },
                  onMouseLeave: () => {
                    input.onHoverTarget(null);
                  },
                };

          return (
            <Fragment key={label}>
              <dt
                className={[
                  "text-muted-foreground rounded px-1 py-0.5 transition-colors",
                  target === null ? "" : "cursor-default",
                  isHovered ? "bg-muted/80 text-foreground" : "",
                ].join(" ")}
                {...interactiveProps}
              >
                {label}
              </dt>
            </Fragment>
          );
        })}
      </dl>
    </aside>
  );
}

export function SessionConversationPaneLayoutPlayground(
  args: SessionConversationPaneStoryArgs,
): React.JSX.Element {
  const [hoveredTarget, setHoveredTarget] = useState<MeasurementHighlightTarget | null>(null);
  const {
    fixture,
    turnGapPx,
    turnContentGapPx,
    assistantBlockGapPx,
    semanticStackGapPx,
    assistantToSemanticGapPx,
    assistantMaxWidthCh,
    userBubbleMaxWidthRem,
    userMessageGapPx,
    semanticGroupGapPx,
    semanticGroupHeaderGapPx,
    semanticGroupSummaryGapPx,
    semanticGroupTitleGapPx,
    semanticGroupIndentPx,
    semanticGroupRowGapPx,
    semanticGroupRowLeading,
    semanticGroupDetailLeading,
    semanticGroupItemGapPx,
    semanticGroupItemDetailGapPx,
    semanticGroupOutputPaddingPx,
    semanticGroupOutputStackGapPx,
    semanticGroupOutputLeading,
    planEntryGapPx,
    planIndentPx,
    planStepGapPx,
    ...conversationArgs
  } = args;

  const playgroundStyle: ConversationPanePlaygroundStyle = {
    "--chat-plan-entry-gap": getTailwindSpacingValue(planEntryGapPx),
    "--chat-plan-entry-indent": getTailwindSpacingValue(planIndentPx),
    "--chat-plan-step-gap": getTailwindSpacingValue(planStepGapPx),
    "--chat-semantic-group-content-gap": getTailwindSpacingValue(semanticGroupGapPx),
    "--chat-semantic-group-gap": getTailwindSpacingValue(semanticGroupGapPx),
    "--chat-semantic-group-header-gap": getTailwindSpacingValue(semanticGroupHeaderGapPx),
    "--chat-semantic-group-detail-leading": getTailwindLeadingValue(semanticGroupDetailLeading),
    "--chat-semantic-group-indent": getTailwindSpacingValue(semanticGroupIndentPx),
    "--chat-semantic-group-item-detail-gap": getTailwindSpacingValue(semanticGroupItemDetailGapPx),
    "--chat-semantic-group-item-gap": getTailwindSpacingValue(semanticGroupItemGapPx),
    "--chat-semantic-group-output-leading": getTailwindLeadingValue(semanticGroupOutputLeading),
    "--chat-semantic-group-output-padding": getTailwindSpacingValue(semanticGroupOutputPaddingPx),
    "--chat-semantic-group-output-stack-gap": getTailwindSpacingValue(
      semanticGroupOutputStackGapPx,
    ),
    "--chat-semantic-group-row-gap": getTailwindSpacingValue(semanticGroupRowGapPx),
    "--chat-semantic-group-row-leading": getTailwindLeadingValue(semanticGroupRowLeading),
    "--chat-semantic-group-summary-gap": getTailwindSpacingValue(semanticGroupSummaryGapPx),
    "--chat-semantic-group-title-gap": getTailwindSpacingValue(semanticGroupTitleGapPx),
    "--chat-thread-assistant-block-gap": getTailwindSpacingValue(assistantBlockGapPx),
    "--chat-thread-assistant-max-width": `${String(assistantMaxWidthCh)}ch`,
    "--chat-thread-assistant-to-semantic-gap": getTailwindSpacingValue(assistantToSemanticGapPx),
    "--chat-thread-padding-top": "8px",
    "--chat-thread-semantic-stack-gap": getTailwindSpacingValue(semanticStackGapPx),
    "--chat-thread-turn-content-gap": getTailwindSpacingValue(turnContentGapPx),
    "--chat-thread-turn-gap": getTailwindSpacingValue(turnGapPx),
    "--chat-user-message-content-gap": getTailwindSpacingValue(userMessageGapPx),
    "--chat-user-message-max-width": `${String(userBubbleMaxWidthRem)}rem`,
  };

  return (
    <div
      className="h-full"
      data-conversation-layout-playground
      data-highlight-target={hoveredTarget ?? ""}
      style={playgroundStyle}
    >
      <style>{`
        [data-conversation-layout-playground][data-highlight-target="turn-group"] [data-chat-turn-group],
        [data-conversation-layout-playground][data-highlight-target="turn-content"] [data-chat-turn-group],
        [data-conversation-layout-playground][data-highlight-target="assistant-width"] [data-chat-assistant-blocks],
        [data-conversation-layout-playground][data-highlight-target="assistant-stack"] [data-chat-assistant-block][data-chat-block-kind="semantic-group"],
        [data-conversation-layout-playground][data-highlight-target="semantic-group"] [data-chat-semantic-group],
        [data-conversation-layout-playground][data-highlight-target="semantic-header"] [data-chat-semantic-group-summary],
        [data-conversation-layout-playground][data-highlight-target="semantic-summary"] [data-chat-semantic-group-summary-cluster],
        [data-conversation-layout-playground][data-highlight-target="semantic-title"] [data-chat-semantic-group-title-cluster],
        [data-conversation-layout-playground][data-highlight-target="semantic-indent"] [data-chat-semantic-group-items],
        [data-conversation-layout-playground][data-highlight-target="semantic-row"] [data-chat-semantic-group-item-row],
        [data-conversation-layout-playground][data-highlight-target="semantic-row-leading"] [data-chat-semantic-group-item-row],
        [data-conversation-layout-playground][data-highlight-target="semantic-detail"] [data-chat-semantic-group-item-detail],
        [data-conversation-layout-playground][data-highlight-target="semantic-detail"] [data-chat-semantic-group-item-status],
        [data-conversation-layout-playground][data-highlight-target="semantic-item-gap"] [data-chat-semantic-group-items],
        [data-conversation-layout-playground][data-highlight-target="semantic-item-detail-gap"] [data-chat-semantic-group-item],
        [data-conversation-layout-playground][data-highlight-target="semantic-output-margin"] [data-chat-semantic-group-output],
        [data-conversation-layout-playground][data-highlight-target="semantic-output-padding"] [data-chat-semantic-group-output],
        [data-conversation-layout-playground][data-highlight-target="semantic-output-stack"] [data-chat-semantic-group-output-result],
        [data-conversation-layout-playground][data-highlight-target="semantic-output-leading"] [data-chat-semantic-group-output],
        [data-conversation-layout-playground][data-highlight-target="plan-gap"] [data-chat-plan-entry],
        [data-conversation-layout-playground][data-highlight-target="plan-indent"] [data-chat-plan-entry],
        [data-conversation-layout-playground][data-highlight-target="plan-step-gap"] [data-chat-plan-entry] {
          box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--color-sky-500) 60%, transparent);
          background: color-mix(in oklab, var(--color-sky-500) 12%, transparent);
          border-radius: 0.75rem;
        }

        [data-conversation-layout-playground][data-highlight-target="user-bubble"] [data-chat-user-message-bubble],
        [data-conversation-layout-playground][data-highlight-target="user-content"] [data-chat-user-message-bubble],
        [data-conversation-layout-playground][data-highlight-target="assistant-block"] [data-chat-assistant-block],
        [data-conversation-layout-playground][data-highlight-target="assistant-to-semantic"] [data-chat-assistant-block][data-chat-block-kind="semantic-group"] {
          box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--color-amber-500) 60%, transparent);
          background: color-mix(in oklab, var(--color-amber-500) 10%, transparent);
          border-radius: 0.75rem;
        }
      `}</style>
      <div className="relative h-full min-h-0 w-full">
        <div className="pointer-events-none fixed top-4 right-6 z-20 hidden w-56 xl:flex xl:flex-col">
          <div className="pointer-events-auto">
            {renderMeasurementHud({
              fixture,
              turnGapPx,
              turnContentGapPx,
              assistantBlockGapPx,
              semanticStackGapPx,
              assistantToSemanticGapPx,
              assistantMaxWidthCh,
              userBubbleMaxWidthRem,
              userMessageGapPx,
              semanticGroupGapPx,
              semanticGroupHeaderGapPx,
              semanticGroupSummaryGapPx,
              semanticGroupTitleGapPx,
              semanticGroupIndentPx,
              semanticGroupRowGapPx,
              semanticGroupRowLeading,
              semanticGroupDetailLeading,
              semanticGroupItemGapPx,
              semanticGroupItemDetailGapPx,
              semanticGroupOutputPaddingPx,
              semanticGroupOutputStackGapPx,
              semanticGroupOutputLeading,
              planEntryGapPx,
              planIndentPx,
              planStepGapPx,
              hoveredTarget,
              onHoverTarget: setHoveredTarget,
            })}
          </div>
        </div>
        <div className="h-full min-h-0 min-w-0">
          <SessionConversationMainContent
            {...conversationArgs}
            chatEntries={getPlaygroundChatEntries(fixture)}
          />
        </div>
      </div>
    </div>
  );
}

export const SessionConversationPanePlaygroundArgTypes = {
  scrollBehavior: SessionConversationScrollBehaviorArgType,
  fixture: {
    control: "select",
    description: "Fixture preset used by the layout playground.",
    options: ["mixed", "default", "exploring", "sequential", "thinking", "plan", "generic"],
  },
  turnGapPx: {
    control: "select",
    description: "Vertical gap between top-level turn groups, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  turnContentGapPx: {
    control: "select",
    description:
      "Gap between the user bubble and assistant content inside a turn, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  assistantBlockGapPx: {
    control: "select",
    description:
      "Default gap between assistant blocks in the same turn, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  semanticStackGapPx: {
    control: "select",
    description:
      "Gap used when two semantic groups appear back to back, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  assistantToSemanticGapPx: {
    control: "select",
    description:
      "Gap from an assistant text message into the next semantic group, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  assistantMaxWidthCh: {
    control: { min: 40, max: 96, step: 2, type: "range" },
    description: "Maximum readable width of assistant content.",
  },
  userBubbleMaxWidthRem: {
    control: { min: 20, max: 48, step: 1, type: "range" },
    description: "Maximum width of the user message bubble.",
  },
  userMessageGapPx: {
    control: "select",
    description: "Gap between user text and attachment pills, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupGapPx: {
    control: "select",
    description:
      "Outer gap around semantic group headings and body content, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupHeaderGapPx: {
    control: "select",
    description: "Gap between the semantic group title cluster and its trailing content.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupSummaryGapPx: {
    control: "select",
    description: "Gap between the semantic group title and summary count.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupTitleGapPx: {
    control: "select",
    description: "Gap between semantic labels and the caret icon.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupIndentPx: {
    control: "select",
    description: "Left indent for semantic group items, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupRowGapPx: {
    control: "select",
    description: "Gap between an item label cluster and its detail text.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupRowLeading: {
    control: "select",
    description: "Line-height for semantic item rows.",
    options: TailwindLeadingTokenOptions,
  },
  semanticGroupDetailLeading: {
    control: "select",
    description: "Line-height for semantic detail text and status labels.",
    options: TailwindLeadingTokenOptions,
  },
  semanticGroupItemGapPx: {
    control: "select",
    description: "Gap between semantic group rows, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupItemDetailGapPx: {
    control: "select",
    description:
      "Gap between a semantic row and its expanded details, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupOutputPaddingPx: {
    control: "select",
    description: "Inner padding for semantic output blocks and result indents.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupOutputStackGapPx: {
    control: "select",
    description: "Vertical gap between stacked semantic output results.",
    options: TailwindSpacingTokenOptions,
  },
  semanticGroupOutputLeading: {
    control: "select",
    description: "Line-height for semantic output content.",
    options: TailwindLeadingTokenOptions,
  },
  planEntryGapPx: {
    control: "select",
    description: "Vertical gap inside plan blocks, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  planIndentPx: {
    control: "select",
    description:
      "Left indent for plan content and structured steps, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
  planStepGapPx: {
    control: "select",
    description: "Gap between plan steps, using the Tailwind spacing scale.",
    options: TailwindSpacingTokenOptions,
  },
} as const;

export const SessionConversationPanePlaygroundControlInclude = [
  "fixture",
  "turnGapPx",
  "turnContentGapPx",
  "assistantBlockGapPx",
  "semanticStackGapPx",
  "assistantToSemanticGapPx",
  "assistantMaxWidthCh",
  "userBubbleMaxWidthRem",
  "userMessageGapPx",
  "semanticGroupGapPx",
  "semanticGroupHeaderGapPx",
  "semanticGroupSummaryGapPx",
  "semanticGroupTitleGapPx",
  "semanticGroupIndentPx",
  "semanticGroupRowGapPx",
  "semanticGroupRowLeading",
  "semanticGroupDetailLeading",
  "semanticGroupItemGapPx",
  "semanticGroupItemDetailGapPx",
  "semanticGroupOutputPaddingPx",
  "semanticGroupOutputStackGapPx",
  "semanticGroupOutputLeading",
  "planEntryGapPx",
  "planIndentPx",
  "planStepGapPx",
] as const;

export const SessionConversationPanePlaygroundDocs = `Use the playground story to tune the conversation pane rhythm in-place. The Controls tab exposes the main spacing and width variables, while the optional grouping outlines show how turns, assistant stacks, semantic groups, and plan blocks nest inside the workbench shell.

Review this story by switching fixtures, adjusting values one control at a time, and comparing how the same rhythm feels across production-shaped replies, grouped tool activity, and structured plan content.`;
