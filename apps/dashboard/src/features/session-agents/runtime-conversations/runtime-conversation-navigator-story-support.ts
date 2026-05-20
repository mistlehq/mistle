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
} satisfies RuntimeConversationSummary;

const RuntimeConversationNavigatorStoryConversations = [
  HistoricalRuntimeConversationNavigatorStoryConversation,
  {
    id: "conversation_review",
    title: "Review terminal port ownership",
    cwd: StoryCwd,
    createdAt: StoryNowMs - 10 * 86_400_000,
    updatedAt: StoryNowMs - 3 * 3_600_000,
  },
  {
    id: "conversation_opening",
    title: "Refresh sandbox setup",
    cwd: StoryCwd,
    createdAt: StoryNowMs - 5 * 86_400_000,
    updatedAt: StoryNowMs - 14 * 60_000,
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
