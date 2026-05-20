export type RuntimeConversationSummary = {
  id: string;
  title: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
};

export type RuntimeConversationNavigatorState = {
  activeConversationCwd: string | null;
  activeConversationId: string | null;
  providerConversationId: string | null;
  availableConversations: readonly RuntimeConversationSummary[];
  hasMoreAvailableConversations: boolean;
  originalConversationId: string | null;
  pendingConversationId: string | null;
  clearContextImplementationConversationId: string | null;
  acknowledgeClearContextImplementationConversation: (conversationId: string) => void;
  isStartingNewConversation: boolean;
  refreshConversationList: (input?: { cwd?: string | null }) => void | Promise<void>;
  resumeConversation: (conversationId: string, input?: { cwd?: string }) => Promise<string>;
  startNewConversation: (input?: { cwd?: string }) => Promise<string>;
};

export type RuntimeConversationNavigatorRow = {
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

export type RuntimeConversationNavigatorActiveConversation = {
  id: string;
  cwd: string | null;
};

function resolveConversationActivityMs(conversation: RuntimeConversationSummary): number | null {
  return conversation.updatedAt ?? conversation.createdAt ?? null;
}

function compareConversationActivity(
  left: RuntimeConversationSummary,
  right: RuntimeConversationSummary,
): number {
  const leftActivityMs = resolveConversationActivityMs(left) ?? Number.NEGATIVE_INFINITY;
  const rightActivityMs = resolveConversationActivityMs(right) ?? Number.NEGATIVE_INFINITY;
  const activityDifference = rightActivityMs - leftActivityMs;
  if (activityDifference !== 0) {
    return activityDifference;
  }

  return right.id.localeCompare(left.id);
}

function resolveConversationTitle(conversation: RuntimeConversationSummary): string {
  const title = conversation.title.trim();
  if (title.length > 0) {
    return title;
  }

  return "Untitled conversation";
}

function resolveCwdSectionLabel(cwd: string): string {
  if (cwd.length === 0) {
    return "Current conversation";
  }

  const pathSegments = cwd.split("/").filter((segment) => segment.length > 0);
  return pathSegments.at(-1) ?? cwd;
}

function createNavigatorRow(input: {
  activeConversationId: string | null;
  pendingConversationId: string | null;
  pendingServerRequestCountsByConversationId: ReadonlyMap<string, number>;
  conversation: RuntimeConversationSummary;
  originalConversationId: string | null;
}): RuntimeConversationNavigatorRow {
  return {
    id: input.conversation.id,
    title: resolveConversationTitle(input.conversation),
    cwd: input.conversation.cwd,
    cwdSectionLabel: resolveCwdSectionLabel(input.conversation.cwd),
    lastActivityAt: resolveConversationActivityMs(input.conversation),
    isActive: input.conversation.id === input.activeConversationId,
    isOpening: input.conversation.id === input.pendingConversationId,
    isOriginal: input.conversation.id === input.originalConversationId,
    isPinnedCurrent: false,
    pendingServerRequestCount:
      input.pendingServerRequestCountsByConversationId.get(input.conversation.id) ?? 0,
  };
}

function createPinnedActiveConversationRow(input: {
  activeConversation: RuntimeConversationNavigatorActiveConversation;
  pendingConversationId: string | null;
  pendingServerRequestCountsByConversationId: ReadonlyMap<string, number>;
  originalConversationId: string | null;
}): RuntimeConversationNavigatorRow {
  return {
    id: input.activeConversation.id,
    title: "New conversation",
    cwd: input.activeConversation.cwd ?? "",
    cwdSectionLabel: resolveCwdSectionLabel(input.activeConversation.cwd ?? ""),
    lastActivityAt: null,
    isActive: true,
    isOpening: input.activeConversation.id === input.pendingConversationId,
    isOriginal: input.activeConversation.id === input.originalConversationId,
    isPinnedCurrent: true,
    pendingServerRequestCount:
      input.pendingServerRequestCountsByConversationId.get(input.activeConversation.id) ?? 0,
  };
}

function countPendingServerRequestsByConversationId(
  conversationIds: readonly string[],
): ReadonlyMap<string, number> {
  const countsByConversationId = new Map<string, number>();
  for (const conversationId of conversationIds) {
    countsByConversationId.set(
      conversationId,
      (countsByConversationId.get(conversationId) ?? 0) + 1,
    );
  }

  return countsByConversationId;
}

export function projectRuntimeConversationNavigatorRows(input: {
  activeConversationId: string | null;
  activeConversation: RuntimeConversationNavigatorActiveConversation | null;
  availableConversations: readonly RuntimeConversationSummary[];
  originalConversationId: string | null;
  pendingConversationId: string | null;
  pendingServerRequestConversationIds: readonly string[];
}): readonly RuntimeConversationNavigatorRow[] {
  const pendingServerRequestCountsByConversationId = countPendingServerRequestsByConversationId(
    input.pendingServerRequestConversationIds,
  );
  const sortedConversations = [...input.availableConversations].sort(compareConversationActivity);

  const rows = sortedConversations.map((conversation) =>
    createNavigatorRow({
      activeConversationId: input.activeConversationId,
      pendingConversationId: input.pendingConversationId,
      pendingServerRequestCountsByConversationId,
      conversation,
      originalConversationId: input.originalConversationId,
    }),
  );

  if (
    input.activeConversationId === null ||
    rows.some((row) => row.id === input.activeConversationId)
  ) {
    return rows;
  }

  if (
    input.activeConversation === null ||
    input.activeConversation.id !== input.activeConversationId
  ) {
    return rows;
  }

  return [
    createPinnedActiveConversationRow({
      activeConversation: input.activeConversation,
      pendingConversationId: input.pendingConversationId,
      pendingServerRequestCountsByConversationId,
      originalConversationId: input.originalConversationId,
    }),
    ...rows,
  ];
}
