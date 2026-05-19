import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

export type CodexThreadNavigatorRow = {
  id: string;
  title: string;
  preview: string | null;
  cwd: string;
  cwdSectionLabel: string;
  updatedAt: number | null;
  createdAt: number | null;
  isActive: boolean;
  isLoaded: boolean;
  isOpening: boolean;
  isPinnedCurrent: boolean;
  pendingServerRequestCount: number;
};

function resolveThreadActivityMs(thread: CodexThreadSummary): number {
  return thread.updatedAt ?? thread.createdAt ?? Number.NEGATIVE_INFINITY;
}

function compareThreadActivity(left: CodexThreadSummary, right: CodexThreadSummary): number {
  const activityDifference = resolveThreadActivityMs(right) - resolveThreadActivityMs(left);
  if (activityDifference !== 0) {
    return activityDifference;
  }

  return right.id.localeCompare(left.id);
}

function resolveThreadTitle(thread: CodexThreadSummary): string {
  if (thread.name !== null && thread.name.trim().length > 0) {
    return thread.name.trim();
  }

  const previewTitle = thread.preview
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (previewTitle !== undefined) {
    return previewTitle;
  }

  return "Untitled thread";
}

function resolveCwdSectionLabel(cwd: string): string {
  const pathSegments = cwd.split("/").filter((segment) => segment.length > 0);
  return pathSegments.at(-1) ?? cwd;
}

function createNavigatorRow(input: {
  activeThreadId: string | null;
  loadedThreadIds: ReadonlySet<string>;
  pendingThreadId: string | null;
  pendingServerRequestCountsByThreadId: ReadonlyMap<string, number>;
  thread: CodexThreadSummary;
  isPinnedCurrent: boolean;
}): CodexThreadNavigatorRow {
  return {
    id: input.thread.id,
    title: resolveThreadTitle(input.thread),
    preview: input.thread.preview,
    cwd: input.thread.cwd,
    cwdSectionLabel: resolveCwdSectionLabel(input.thread.cwd),
    updatedAt: input.thread.updatedAt,
    createdAt: input.thread.createdAt,
    isActive: input.thread.id === input.activeThreadId,
    isLoaded: input.loadedThreadIds.has(input.thread.id),
    isOpening: input.thread.id === input.pendingThreadId,
    isPinnedCurrent: input.isPinnedCurrent,
    pendingServerRequestCount: input.pendingServerRequestCountsByThreadId.get(input.thread.id) ?? 0,
  };
}

function countPendingServerRequestsByThreadId(
  threadIds: readonly string[],
): ReadonlyMap<string, number> {
  const countsByThreadId = new Map<string, number>();
  for (const threadId of threadIds) {
    countsByThreadId.set(threadId, (countsByThreadId.get(threadId) ?? 0) + 1);
  }

  return countsByThreadId;
}

export function projectCodexThreadNavigatorRows(input: {
  activeThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  pendingThreadId: string | null;
  pendingServerRequestThreadIds: readonly string[];
}): readonly CodexThreadNavigatorRow[] {
  const loadedThreadIds = new Set(input.loadedThreadIds);
  const pendingServerRequestCountsByThreadId = countPendingServerRequestsByThreadId(
    input.pendingServerRequestThreadIds,
  );
  const sortedThreads = [...input.availableThreads].sort(compareThreadActivity);

  const rows = sortedThreads.map((thread) =>
    createNavigatorRow({
      activeThreadId: input.activeThreadId,
      loadedThreadIds,
      pendingThreadId: input.pendingThreadId,
      pendingServerRequestCountsByThreadId,
      thread,
      isPinnedCurrent: false,
    }),
  );

  if (input.activeThreadId === null || rows.some((row) => row.id === input.activeThreadId)) {
    return rows;
  }

  const activeThread = sortedThreads.find((thread) => thread.id === input.activeThreadId);
  if (activeThread === undefined) {
    return rows;
  }

  return [
    createNavigatorRow({
      activeThreadId: input.activeThreadId,
      loadedThreadIds,
      pendingThreadId: input.pendingThreadId,
      pendingServerRequestCountsByThreadId,
      thread: activeThread,
      isPinnedCurrent: true,
    }),
    ...rows,
  ];
}

export function resolveDefaultCodexThreadId(input: {
  availableThreads: readonly CodexThreadSummary[];
}): string | null {
  const defaultThread = [...input.availableThreads].sort(compareThreadActivity)[0];
  return defaultThread?.id ?? null;
}
