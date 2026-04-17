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
  SessionComposerFixtureProps,
  CodexFixtureSessionEntries,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import type {
  ConversationPaneFixtureId,
  ConversationPaneLayoutPlaygroundControls,
} from "./session-conversation-pane-playground-tokens.js";
import type { SessionConversationScrollBehavior } from "./session-conversation-scroll-behavior.js";
import {
  StorySessionConversationPaneArgs,
  type SessionConversationStoryArgs,
} from "./session-story-support.js";

export type SessionConversationPaneStoryArgs = SessionConversationStoryArgs &
  ConversationPaneLayoutPlaygroundControls & {
    scrollBehavior?: SessionConversationScrollBehavior;
  };

export const SessionConversationPanePlaygroundBaseArgs = {
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
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
} satisfies SessionConversationPaneStoryArgs;

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

export function getPlaygroundChatEntries(
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
