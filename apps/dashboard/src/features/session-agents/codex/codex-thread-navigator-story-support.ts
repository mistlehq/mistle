import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import {
  projectCodexThreadNavigatorRows,
  type CodexThreadNavigatorRow,
} from "./codex-thread-navigator-model.js";
import type { CodexThreadNavigatorProps } from "./codex-thread-navigator.js";

const StoryNowMs = Date.now();
const StoryCwd = "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling";

const HistoricalCodexThreadNavigatorStoryThread = {
  id: "thread_active",
  name: "Implement thread navigation",
  preview: null,
  cwd: StoryCwd,
  createdAt: StoryNowMs - 14 * 86_400_000,
  updatedAt: StoryNowMs - 2 * 86_400_000,
} satisfies CodexThreadSummary;

const CodexThreadNavigatorStoryThreads = [
  HistoricalCodexThreadNavigatorStoryThread,
  {
    id: "thread_review",
    name: "Review terminal port ownership",
    preview: null,
    cwd: StoryCwd,
    createdAt: StoryNowMs - 10 * 86_400_000,
    updatedAt: StoryNowMs - 3 * 3_600_000,
  },
  {
    id: "thread_opening",
    name: "Refresh sandbox setup",
    preview: null,
    cwd: StoryCwd,
    createdAt: StoryNowMs - 5 * 86_400_000,
    updatedAt: StoryNowMs - 14 * 60_000,
  },
] satisfies readonly CodexThreadSummary[];

export const CodexThreadNavigatorStoryRows = projectCodexThreadNavigatorRows({
  activeThreadId: "thread_new",
  activeThread: {
    id: "thread_new",
    cwd: StoryCwd,
  },
  availableThreads: CodexThreadNavigatorStoryThreads,
  originalThreadId: HistoricalCodexThreadNavigatorStoryThread.id,
  pendingThreadId: "thread_opening",
  pendingServerRequestThreadIds: ["thread_review"],
});

export const CodexThreadNavigatorWorkbenchStoryRows = CodexThreadNavigatorStoryRows.filter(
  (row) => row.id !== "thread_opening",
);

export function createCodexThreadNavigatorStoryProps(input?: {
  isThreadListLimited?: boolean;
  rows?: readonly CodexThreadNavigatorRow[];
}): CodexThreadNavigatorProps {
  return {
    isThreadListLimited: input?.isThreadListLimited ?? false,
    isStartingThread: false,
    onRefreshThreads: function onRefreshThreads() {},
    onSelectThread: function onSelectThread() {},
    onStartThread: function onStartThread() {},
    rows: input?.rows ?? CodexThreadNavigatorStoryRows,
  };
}
