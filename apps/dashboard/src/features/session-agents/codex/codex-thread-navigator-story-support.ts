import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";
import type { CodexThreadNavigatorProps } from "./codex-thread-navigator.js";

const ActiveCodexThreadNavigatorStoryRow = {
  id: "thread_active",
  title: "Implement thread navigation",
  cwd: "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling",
  cwdSectionLabel: "mistle-add-threads-handling",
  isActive: true,
  isOpening: false,
  isPinnedCurrent: false,
  pendingServerRequestCount: 0,
} satisfies CodexThreadNavigatorRow;

export const CodexThreadNavigatorStoryRows = [
  ActiveCodexThreadNavigatorStoryRow,
  {
    id: "thread_review",
    title: "Review terminal port ownership",
    cwd: "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling",
    cwdSectionLabel: "mistle-add-threads-handling",
    isActive: false,
    isOpening: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 1,
  },
  {
    id: "thread_opening",
    title: "Refresh sandbox setup",
    cwd: "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling",
    cwdSectionLabel: "mistle-add-threads-handling",
    isActive: false,
    isOpening: true,
    isPinnedCurrent: false,
    pendingServerRequestCount: 0,
  },
  {
    id: "thread_other_repo",
    title: "Draft launch note",
    cwd: "/Users/jonathanlow/mistle-projects/mistle.dev",
    cwdSectionLabel: "mistle.dev",
    isActive: false,
    isOpening: false,
    isPinnedCurrent: true,
    pendingServerRequestCount: 0,
  },
] satisfies readonly CodexThreadNavigatorRow[];

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
