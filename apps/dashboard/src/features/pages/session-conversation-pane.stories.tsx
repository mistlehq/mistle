import type { Meta, StoryObj } from "@storybook/react-vite";
import { Fragment, useState } from "react";

import {
  CodexFixtureExploringGroupEntry,
  CodexFixtureChatThreadEntriesWithGenericItem,
  CodexFixtureRunningCommandsGroupEntry,
  CodexFixtureSearchingWebGroupEntry,
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithSequentialActionGroups,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
  CodexFixtureThinkingGroupEntry,
  CodexFixtureToolCallGroupEntry,
} from "../session-agents/codex/fixtures/chat-fixtures.js";
import {
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixturePropsUploadingImageAttachments,
  SessionComposerFixturePropsWithPendingImageAttachments,
  SessionComposerFixtureProps,
  CodexFixtureSessionEntries,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import { SessionConversationMainContent } from "./session-conversation-pane.js";
import {
  createStorySessionBottomPanel,
  renderSessionWorkbenchContentStory,
  StorySessionConversationPaneArgs,
  type SessionConversationStoryArgs,
} from "./session-story-support.js";

type ConversationPaneFixtureId =
  | "mixed"
  | "default"
  | "exploring"
  | "sequential"
  | "thinking"
  | "plan"
  | "generic";

const TailwindSpacingScale = {
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

type TailwindSpacingToken = keyof typeof TailwindSpacingScale;

const TailwindLeadingScale = {
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

type TailwindLeadingToken = keyof typeof TailwindLeadingScale;

const TailwindSpacingTokenOptions = Object.keys(TailwindSpacingScale) as TailwindSpacingToken[];
const TailwindLeadingTokenOptions = Object.keys(TailwindLeadingScale) as TailwindLeadingToken[];

function getTailwindSpacingValue(token: TailwindSpacingToken): string {
  return TailwindSpacingScale[token];
}

function formatTailwindSpacingToken(token: TailwindSpacingToken): string {
  return `${token} (${getTailwindSpacingValue(token)})`;
}

function getTailwindLeadingValue(token: TailwindLeadingToken): string {
  return TailwindLeadingScale[token];
}

function formatTailwindLeadingToken(token: TailwindLeadingToken): string {
  return `${token} (${getTailwindLeadingValue(token)})`;
}

type MeasurementHighlightTarget =
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

type ConversationPaneLayoutPlaygroundControls = {
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
  showGroupingOutlines: boolean;
};

type SessionConversationPaneStoryArgs = SessionConversationStoryArgs &
  ConversationPaneLayoutPlaygroundControls;

type ConversationPanePlaygroundStyle = React.CSSProperties & {
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

const baseArgs = {
  ...StorySessionConversationPaneArgs,
  chatEntries: CodexFixtureSessionEntries,
  composerViewModel: SessionComposerFixtureProps,
  fixture: "mixed",
  turnGapPx: "gap-4",
  turnContentGapPx: "gap-4",
  assistantBlockGapPx: "gap-4",
  semanticStackGapPx: "gap-2",
  assistantToSemanticGapPx: "gap-4",
  assistantMaxWidthCh: 72,
  userBubbleMaxWidthRem: 38,
  userMessageGapPx: "gap-2",
  semanticGroupGapPx: "gap-1",
  semanticGroupHeaderGapPx: "gap-3",
  semanticGroupSummaryGapPx: "gap-2",
  semanticGroupTitleGapPx: "gap-1.5",
  semanticGroupIndentPx: "gap-4",
  semanticGroupRowGapPx: "gap-2",
  semanticGroupRowLeading: "leading-6",
  semanticGroupDetailLeading: "leading-5",
  semanticGroupItemGapPx: "gap-0",
  semanticGroupItemDetailGapPx: "gap-1",
  semanticGroupOutputPaddingPx: "gap-3",
  semanticGroupOutputStackGapPx: "gap-1.5",
  semanticGroupOutputLeading: "leading-5",
  planEntryGapPx: "gap-1",
  planIndentPx: "gap-4",
  planStepGapPx: "gap-0.5",
  showGroupingOutlines: false,
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
};

const CodexFixtureConversationPaneMixedEntries: SessionConversationStoryArgs["chatEntries"] = [
  ...CodexFixtureSessionEntries,
  {
    id: "user-mixed-production-1",
    turnId: "turn-mixed-production",
    kind: "user-message",
    status: "completed",
    text: "What is in this repo? Give me a quick inventory, show me what you inspect along the way, and then summarize it clearly.",
  },
  {
    id: "assistant-mixed-production-1",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "You’re asking for a quick inventory of this repository. I’ll scan the top-level structure and the main docs first so the summary is grounded in what is actually here.",
  },
  {
    id: "assistant-mixed-production-1b",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "I want the answer to stay concise, but I also want the intermediate exploration to remain visible so you can judge whether the conversation still reads cleanly once prose and grouped activity start alternating.",
  },
  {
    ...CodexFixtureRunningCommandsGroupEntry,
    id: "running-commands-group-mixed-1",
    turnId: "turn-mixed-production",
  },
  {
    ...CodexFixtureExploringGroupEntry,
    id: "exploring-group-mixed-early-1",
    turnId: "turn-mixed-production",
  },
  {
    id: "assistant-mixed-production-2",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "I’ve got the top-level shape. Next I’m reading the main repository docs so I can tell you what the repo is for, how the workspaces are split, and which parts look like active application surfaces versus supporting packages.",
  },
  {
    id: "assistant-mixed-production-2b",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "This is the point in a real Codex thread where the model usually pauses to explain what it learned before surfacing the next set of reads. That makes it a useful rhythm to keep in the playground.",
  },
  {
    ...CodexFixtureExploringGroupEntry,
    id: "exploring-group-mixed-1",
    turnId: "turn-mixed-production",
  },
  {
    id: "assistant-mixed-production-3",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "The repo reads like a code-first monorepo with a clear split between product apps, shared packages, and supporting infrastructure. The docs give enough signal to explain both the product direction and the internal development model.",
  },
  {
    id: "assistant-mixed-production-3b",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "What I still want before closing the answer is one pass over the generated or operational tooling so the final summary is not just a directory listing. That usually means another small burst of file reads and maybe one targeted list.\n\nAt this point I would usually check `scripts/`, glance at `pnpm test`, and confirm whether a generated surface like `packages/control-plane-internal-client/src/generated/schema.ts` is active or mostly drift-free before I write the wrap-up.",
  },
  {
    id: "assistant-mixed-production-3c",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "If this spacing is working, the longer paragraph above should feel calm, and the next grouped section should still scan as a continuation of the same answer rather than a hard visual reset.",
  },
  {
    ...CodexFixtureToolCallGroupEntry,
    id: "tool-call-group-mixed-1",
    turnId: "turn-mixed-production",
  },
  {
    ...CodexFixtureSearchingWebGroupEntry,
    id: "searching-web-group-mixed-consecutive-1",
    turnId: "turn-mixed-production",
  },
  {
    id: "assistant-mixed-production-4",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "This repo is primarily organized around a few major concerns:",
      "",
      "- product apps that expose the control-plane, data-plane, dashboard, and docs surfaces",
      "- shared packages for common contracts, infrastructure, UI, and integrations",
      "  - UI surfaces like `@mistle/ui` and shared protocol layers show up repeatedly",
      "  - generated clients are worth checking before summarizing:",
      "    `packages/control-plane-internal-client/src/generated/schema.ts`",
      "- workflow and sandbox machinery that supports the agent runtime model",
    ].join("\n"),
  },
  {
    id: "assistant-mixed-production-4a",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The operational side usually gets checked separately:",
      "",
      "1. scripts under `scripts/` help explain how the repo is maintained",
      "2. commands like `pnpm test` and `pnpm lint` show which contributor paths are exercised most often",
    ].join("\n"),
  },
  {
    id: "assistant-mixed-production-4b",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "This part of the fixture intentionally includes two consecutive grouped sections before the prose resumes. That gives you one realistic example of adjacent activity bursts without turning the whole story back into a synthetic stress case.",
  },
  {
    id: "assistant-mixed-production-4c",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "The docs and workspace naming are consistent enough that a quick inventory can stay concrete instead of hand-wavy. The remaining judgment call is mostly how much operational detail to include in the final summary.",
  },
  {
    ...CodexFixtureSearchingWebGroupEntry,
    id: "searching-web-group-mixed-1",
    turnId: "turn-mixed-production",
  },
  {
    id: "assistant-mixed-production-5",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "At this point I have enough to answer cleanly. The repo looks like an AgentOS-style monorepo with application workspaces, shared packages, and agent/runtime support code all living in one place.",
  },
  {
    id: "assistant-mixed-production-5b",
    turnId: "turn-mixed-production",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "A concise response would call out the main apps, the shared package layer, and the fact that the repository includes both product UI and the underlying workflow machinery. If you want, this is also a good place to end with a short bullet list because the user asked for an inventory rather than a narrative deep dive.",
  },
  ...CodexFixtureChatThreadEntriesWithStructuredPlan,
  ...CodexFixtureChatThreadEntriesWithGenericItem,
  {
    id: "user-mixed-thinking-1",
    turnId: "turn-mixed-thinking",
    kind: "user-message",
    status: "completed",
    text: "Also show me a smaller reasoning-only example after that.",
  },
  {
    ...CodexFixtureThinkingGroupEntry,
    id: "thinking-group-mixed-1",
    turnId: "turn-mixed-thinking",
  },
  {
    id: "assistant-mixed-thinking-1",
    turnId: "turn-mixed-thinking",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "This last turn keeps a compact reasoning block in the mix so you can still compare the lighter-weight cadence against the longer production-style answer above.",
  },
];

function renderGroupingLegend(): React.JSX.Element {
  return (
    <aside className="bg-background/95 text-foreground sticky top-4 flex w-full flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur-sm">
      <p className="font-medium text-xs tracking-[0.18em] uppercase">Layout Map</p>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block size-3 rounded-sm bg-sky-500/15 ring-1 ring-sky-500/45" />
        <span>Turn group</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block size-3 rounded-sm bg-emerald-500/15 ring-1 ring-emerald-500/45" />
        <span>Assistant stack</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block size-3 rounded-sm bg-amber-500/15 ring-1 ring-amber-500/45" />
        <span>User bubble</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block size-3 rounded-sm bg-rose-500/15 ring-1 ring-rose-500/45" />
        <span>Semantic group</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block size-3 rounded-sm bg-violet-500/15 ring-1 ring-violet-500/45" />
        <span>Plan block</span>
      </div>
    </aside>
  );
}

function renderMeasurementHud(input: {
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
    <aside className="bg-background/95 text-foreground sticky top-4 flex w-72 flex-col gap-3 rounded-xl border p-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-xs tracking-[0.18em] uppercase">Measurements</p>
        <p className="text-muted-foreground text-[11px] uppercase tracking-[0.18em]">Live</p>
      </div>
      <dl className="grid grid-cols-[auto_auto] justify-between gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([label, value, target]) => {
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
              <dd
                className={[
                  "font-mono rounded px-1 py-0.5 transition-colors",
                  target === null ? "" : "cursor-default",
                  isHovered ? "bg-muted/80" : "",
                ].join(" ")}
                {...interactiveProps}
              >
                {value}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </aside>
  );
}

function getPlaygroundChatEntries(
  fixture: ConversationPaneFixtureId,
): SessionConversationStoryArgs["chatEntries"] {
  if (fixture === "mixed") {
    return CodexFixtureConversationPaneMixedEntries;
  }

  if (fixture === "default") {
    return CodexFixtureSessionEntries;
  }

  if (fixture === "exploring") {
    return CodexFixtureSessionEntriesWithExploringGroup;
  }

  if (fixture === "sequential") {
    return CodexFixtureChatThreadEntriesWithSequentialActionGroups;
  }

  if (fixture === "thinking") {
    return CodexFixtureChatThreadEntriesWithThinkingGroup;
  }

  if (fixture === "generic") {
    return CodexFixtureChatThreadEntriesWithGenericItem;
  }

  return CodexFixtureChatThreadEntriesWithStructuredPlan;
}

function renderConversationPaneLayoutPlayground(
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
    showGroupingOutlines,
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
      data-show-grouping-outlines={showGroupingOutlines ? "true" : "false"}
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

        [data-conversation-layout-playground][data-show-grouping-outlines="true"] [data-chat-turn-group] {
          background: color-mix(in oklab, var(--color-sky-500) 7%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-sky-500) 38%, transparent);
          border-radius: 1rem;
        }

        [data-conversation-layout-playground][data-show-grouping-outlines="true"] [data-chat-assistant-blocks] {
          background: color-mix(in oklab, var(--color-emerald-500) 7%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-emerald-500) 32%, transparent);
          border-radius: 0.875rem;
        }

        [data-conversation-layout-playground][data-show-grouping-outlines="true"] [data-chat-user-message-bubble] {
          box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-amber-500) 42%, transparent);
        }

        [data-conversation-layout-playground][data-show-grouping-outlines="true"] [data-chat-semantic-group] {
          background: color-mix(in oklab, var(--color-rose-500) 7%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-rose-500) 32%, transparent);
          border-radius: 0.875rem;
          padding: 0.5rem 0.625rem;
        }

        [data-conversation-layout-playground][data-show-grouping-outlines="true"] [data-chat-plan-entry] {
          background: color-mix(in oklab, var(--color-violet-500) 7%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-violet-500) 32%, transparent);
          border-radius: 0.875rem;
          padding: 0.5rem 0.625rem;
        }
      `}</style>
      <div className="relative h-full min-h-0 w-full">
        <div className="pointer-events-none absolute top-4 right-6 hidden w-80 translate-x-[calc(100%+3rem)] 2xl:flex 2xl:flex-col 2xl:gap-4">
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
          {showGroupingOutlines ? (
            <div className="pointer-events-auto">{renderGroupingLegend()}</div>
          ) : null}
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

/**
 * Use the playground story to tune the conversation pane rhythm in-place. The Controls tab exposes the main spacing and width variables, while the optional grouping outlines show how turns, assistant stacks, semantic groups, and plan blocks nest inside the workbench shell.
 *
 * Review this story by switching fixtures, adjusting values one control at a time, and comparing how the same rhythm feels across production-shaped replies, grouped tool activity, and structured plan content.
 */
const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/ConversationPane",
  component: SessionConversationMainContent,
  tags: ["!autodocs"],
  parameters: {
    docs: {
      disable: true,
    },
    layout: "fullscreen",
  },
  argTypes: {
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
    semanticGroupOutputMarginTopPx: {
      control: "select",
      description: "Top margin above expanded semantic outputs like code blocks and logs.",
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
    showGroupingOutlines: {
      control: "boolean",
      description: "Draw color-coded overlays to show the conversation grouping boundaries.",
    },
  },
  args: baseArgs,
  decorators: [
    function StoryDecorator(Story, context): React.JSX.Element {
      return renderSessionWorkbenchContentStory({
        mainContent: <Story />,
        primaryBottomPanel: createStorySessionBottomPanel(context.args),
      });
    },
  ],
} satisfies Meta<SessionConversationPaneStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LayoutPlayground: Story = {
  args: {
    semanticGroupItemGapPx: "gap-0",
  },

  parameters: {
    controls: {
      include: [
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
        "semanticGroupOutputMarginTopPx",
        "semanticGroupOutputPaddingPx",
        "semanticGroupOutputStackGapPx",
        "semanticGroupOutputLeading",
        "planEntryGapPx",
        "planIndentPx",
        "planStepGapPx",
        "showGroupingOutlines",
      ],
    },
  },

  render: renderConversationPaneLayoutPlayground,
};

export const Default: Story = {};

export const WithExploringGroup: Story = {
  args: {
    chatEntries: CodexFixtureSessionEntriesWithExploringGroup,
  },
};

export const WithSequentialActionGroups: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithSequentialActionGroups,
  },
};

export const WithThinkingGroup: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithThinkingGroup,
  },
};

export const WithStructuredPlan: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithStructuredPlan,
  },
};

export const WithPendingImageAttachments: Story = {
  args: {
    composerViewModel: SessionComposerFixturePropsWithPendingImageAttachments,
  },
};

export const UploadingImageAttachments: Story = {
  args: {
    composerViewModel: SessionComposerFixturePropsUploadingImageAttachments,
    statusMessage: {
      message: "Uploading attachments...",
      variant: "default",
      presentation: "loading",
    },
  },
};

export const WithWorkingFooter: Story = {
  args: {
    activeTurnId: "turn-2",
    chatEntries: CodexFixtureSessionEntries,
    isTurnInProgress: true,
    showWorkingIndicator: true,
  },
};

export const PendingStartWithoutWorkingFooter: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixtureProps,
      isSubmitPending: true,
      submitDisabled: true,
      submitLabel: "Sending...",
    },
    showWorkingIndicator: false,
  },
};

export const DisconnectedWithError: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixtureProps,
      submitDisabled: true,
    },
    statusMessage: {
      message: "The session disconnected before the turn could be submitted.",
      variant: "alert",
      presentation: "notice",
    },
  },
};

export const NonImageCapableModelWithAttachments: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixturePropsForNonImageCapableModel,
    },
    statusMessage: SessionComposerFixtureStatusMessageForNonImageCapableModel,
  },
};

export const LoadingSelectedModelWithAttachments: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixturePropsForLoadingModel,
    },
    statusMessage: SessionComposerFixtureStatusMessageForLoadingModel,
  },
};
