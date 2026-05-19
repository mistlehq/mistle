import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

export type CodexThreadNavigatorRow = {
  id: string;
  title: string;
  cwd: string;
  cwdSectionLabel: string;
  lastActivityAt: number | null;
  isActive: boolean;
  isOpening: boolean;
  isOriginal: boolean;
  isPinnedCurrent: boolean;
  pendingServerRequestCount: number;
};

export type CodexThreadNavigatorActiveThread = {
  id: string;
  cwd: string | null;
};

function resolveThreadActivityMs(thread: CodexThreadSummary): number | null {
  return thread.updatedAt ?? thread.createdAt ?? null;
}

function compareThreadActivity(left: CodexThreadSummary, right: CodexThreadSummary): number {
  const leftActivityMs = resolveThreadActivityMs(left) ?? Number.NEGATIVE_INFINITY;
  const rightActivityMs = resolveThreadActivityMs(right) ?? Number.NEGATIVE_INFINITY;
  const activityDifference = rightActivityMs - leftActivityMs;
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
  pendingThreadId: string | null;
  pendingServerRequestCountsByThreadId: ReadonlyMap<string, number>;
  thread: CodexThreadSummary;
  originalThreadId: string | null;
}): CodexThreadNavigatorRow {
  return {
    id: input.thread.id,
    title: resolveThreadTitle(input.thread),
    cwd: input.thread.cwd,
    cwdSectionLabel: resolveCwdSectionLabel(input.thread.cwd),
    lastActivityAt: resolveThreadActivityMs(input.thread),
    isActive: input.thread.id === input.activeThreadId,
    isOpening: input.thread.id === input.pendingThreadId,
    isOriginal: input.thread.id === input.originalThreadId,
    isPinnedCurrent: false,
    pendingServerRequestCount: input.pendingServerRequestCountsByThreadId.get(input.thread.id) ?? 0,
  };
}

function createPinnedActiveThreadRow(input: {
  activeThread: CodexThreadNavigatorActiveThread;
  pendingThreadId: string | null;
  pendingServerRequestCountsByThreadId: ReadonlyMap<string, number>;
  originalThreadId: string | null;
}): CodexThreadNavigatorRow | null {
  if (input.activeThread.cwd === null) {
    return null;
  }

  return {
    id: input.activeThread.id,
    title: "New thread",
    cwd: input.activeThread.cwd,
    cwdSectionLabel: resolveCwdSectionLabel(input.activeThread.cwd),
    lastActivityAt: null,
    isActive: true,
    isOpening: input.activeThread.id === input.pendingThreadId,
    isOriginal: input.activeThread.id === input.originalThreadId,
    isPinnedCurrent: true,
    pendingServerRequestCount:
      input.pendingServerRequestCountsByThreadId.get(input.activeThread.id) ?? 0,
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
  activeThread: CodexThreadNavigatorActiveThread | null;
  availableThreads: readonly CodexThreadSummary[];
  originalThreadId: string | null;
  pendingThreadId: string | null;
  pendingServerRequestThreadIds: readonly string[];
}): readonly CodexThreadNavigatorRow[] {
  const pendingServerRequestCountsByThreadId = countPendingServerRequestsByThreadId(
    input.pendingServerRequestThreadIds,
  );
  const sortedThreads = [...input.availableThreads].sort(compareThreadActivity);

  const rows = sortedThreads.map((thread) =>
    createNavigatorRow({
      activeThreadId: input.activeThreadId,
      pendingThreadId: input.pendingThreadId,
      pendingServerRequestCountsByThreadId,
      thread,
      originalThreadId: input.originalThreadId,
    }),
  );

  if (input.activeThreadId === null || rows.some((row) => row.id === input.activeThreadId)) {
    return rows;
  }

  if (input.activeThread === null || input.activeThread.id !== input.activeThreadId) {
    return rows;
  }

  const activeThreadRow = createPinnedActiveThreadRow({
    activeThread: input.activeThread,
    pendingThreadId: input.pendingThreadId,
    pendingServerRequestCountsByThreadId,
    originalThreadId: input.originalThreadId,
  });
  if (activeThreadRow === null) {
    return rows;
  }

  return [activeThreadRow, ...rows];
}

export function resolveDefaultCodexThreadId(input: {
  availableThreads: readonly CodexThreadSummary[];
}): string | null {
  const defaultThread = [...input.availableThreads].sort(compareThreadActivity)[0];
  return defaultThread?.id ?? null;
}
