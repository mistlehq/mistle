import {
  projectRuntimeConversationNavigatorRows,
  type RuntimeConversationSummary,
  type RuntimeConversationNavigatorRow,
} from "./runtime-conversation-navigator-model.js";
import type { RuntimeConversationNavigatorProps } from "./runtime-conversation-navigator.js";

const StoryNowMs = Date.now();
const StoryCwd = "/Users/jonathanlow/mistle-projects/mistle-add-conversations-handling";

const HistoricalRuntimeConversationNavigatorStoryConversation = {
  id: "conversation_active",
  title: "Implement conversation navigation",
  cwd: StoryCwd,
  createdAt: StoryNowMs - 14 * 86_400_000,
  updatedAt: StoryNowMs - 2 * 86_400_000,
  lineage: null,
} satisfies RuntimeConversationSummary;

const RuntimeConversationNavigatorStoryConversations = [
  HistoricalRuntimeConversationNavigatorStoryConversation,
  {
    id: "conversation_review",
    title: "Review terminal port ownership",
    cwd: StoryCwd,
    createdAt: StoryNowMs - 10 * 86_400_000,
    updatedAt: StoryNowMs - 3 * 3_600_000,
    lineage: {
      parentConversationId: HistoricalRuntimeConversationNavigatorStoryConversation.id,
      label: "Subagent",
      detail: "reviewer",
    },
  },
  {
    id: "conversation_opening",
    title: "Refresh sandbox setup",
    cwd: StoryCwd,
    createdAt: StoryNowMs - 5 * 86_400_000,
    updatedAt: StoryNowMs - 14 * 60_000,
    lineage: null,
  },
] satisfies readonly RuntimeConversationSummary[];

export const RuntimeConversationNavigatorStoryRows = projectRuntimeConversationNavigatorRows({
  activeConversationId: "conversation_new",
  activeConversation: {
    id: "conversation_new",
    cwd: StoryCwd,
  },
  availableConversations: RuntimeConversationNavigatorStoryConversations,
  originalConversationId: HistoricalRuntimeConversationNavigatorStoryConversation.id,
  pendingConversationId: "conversation_opening",
  pendingServerRequestConversationIds: ["conversation_review"],
});

export const RuntimeConversationNavigatorWorkbenchStoryRows =
  RuntimeConversationNavigatorStoryRows.filter((row) => row.id !== "conversation_opening");

export const RuntimeConversationNavigatorSubagentLineageStoryRows =
  projectRuntimeConversationNavigatorRows({
    activeConversationId: "conversation_subagent_reviewer",
    activeConversation: {
      id: "conversation_subagent_reviewer",
      cwd: StoryCwd,
    },
    availableConversations: [
      {
        id: "conversation_parent",
        title: "Implement Codex thread hierarchy",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 8 * 3_600_000,
        updatedAt: StoryNowMs - 45 * 60_000,
        lineage: null,
      },
      {
        id: "conversation_subagent_reviewer",
        title: "Review navigator lineage behavior",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 2 * 3_600_000,
        updatedAt: StoryNowMs - 5 * 60_000,
        lineage: {
          parentConversationId: "conversation_parent",
          label: "Subagent",
          detail: "reviewer · atlas",
        },
      },
      {
        id: "conversation_subagent_orphan",
        title: "Check archived parent edge case",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 3 * 3_600_000,
        updatedAt: StoryNowMs - 25 * 60_000,
        lineage: {
          parentConversationId: "conversation_archived_parent",
          label: "Subagent",
          detail: "researcher",
        },
      },
      {
        id: "conversation_child_without_metadata",
        title: "Inspect child without metadata",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 4 * 3_600_000,
        updatedAt: StoryNowMs - 50 * 60_000,
        lineage: {
          parentConversationId: "conversation_parent",
          label: null,
          detail: null,
        },
      },
      {
        id: "conversation_standalone",
        title: "Standalone follow-up",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 5 * 3_600_000,
        updatedAt: StoryNowMs - 90 * 60_000,
        lineage: null,
      },
    ],
    originalConversationId: "conversation_parent",
    pendingConversationId: null,
    pendingServerRequestConversationIds: ["conversation_subagent_orphan"],
  });

export const RuntimeConversationNavigatorPlanImplementationStoryRows =
  projectRuntimeConversationNavigatorRows({
    activeConversationId: "conversation_plan_implementation",
    activeConversation: {
      id: "conversation_plan_implementation",
      cwd: StoryCwd,
    },
    availableConversations: [
      {
        id: "conversation_plan_implementation",
        title: "Implement approved plan",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 4 * 60_000,
        updatedAt: StoryNowMs - 60_000,
        lineage: null,
      },
      HistoricalRuntimeConversationNavigatorStoryConversation,
      {
        id: "conversation_plan_review",
        title: "Plan dashboard command flow",
        cwd: StoryCwd,
        createdAt: StoryNowMs - 6 * 3_600_000,
        updatedAt: StoryNowMs - 7 * 60_000,
        lineage: null,
      },
    ],
    originalConversationId: HistoricalRuntimeConversationNavigatorStoryConversation.id,
    pendingConversationId: "conversation_plan_implementation",
    pendingServerRequestConversationIds: [],
  });

export function createRuntimeConversationNavigatorStoryProps(input?: {
  isConversationListLimited?: boolean;
  rows?: readonly RuntimeConversationNavigatorRow[];
}): RuntimeConversationNavigatorProps {
  return {
    isConversationListLimited: input?.isConversationListLimited ?? false,
    isStartingConversation: false,
    onRefreshConversations: function onRefreshConversations() {},
    onSelectConversation: function onSelectConversation() {},
    onStartConversation: function onStartConversation() {},
    rows: input?.rows ?? RuntimeConversationNavigatorStoryRows,
  };
}
