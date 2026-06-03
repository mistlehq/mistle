export type RuntimeConversationSummary = {
  id: string;
  title: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
  lineage: RuntimeConversationLineage | null;
};

export type RuntimeConversationLineage = {
  parentConversationId: string | null;
  label: string | null;
  detail: string | null;
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
  lineage: RuntimeConversationNavigatorRowLineage | null;
};

export type RuntimeConversationNavigatorRowLineage = RuntimeConversationLineage & {
  depth: number;
  parentTitle: string | null;
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
  conversationsById: ReadonlyMap<string, RuntimeConversationSummary>;
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
    lineage: resolveNavigatorRowLineage({
      conversationsById: input.conversationsById,
      conversation: input.conversation,
    }),
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
    lineage: null,
  };
}

function resolveNavigatorRowLineage(input: {
  conversationsById: ReadonlyMap<string, RuntimeConversationSummary>;
  conversation: RuntimeConversationSummary;
}): RuntimeConversationNavigatorRowLineage | null {
  const lineage = input.conversation.lineage;
  if (lineage === null) {
    return null;
  }

  const parentConversation =
    lineage.parentConversationId === null
      ? null
      : (input.conversationsById.get(lineage.parentConversationId) ?? null);
  return {
    ...lineage,
    depth: resolveVisibleLineageDepth({
      conversationsById: input.conversationsById,
      conversation: input.conversation,
      visitedConversationIds: new Set(),
    }),
    parentTitle: parentConversation === null ? null : resolveConversationTitle(parentConversation),
  };
}

function resolveVisibleLineageDepth(input: {
  conversationsById: ReadonlyMap<string, RuntimeConversationSummary>;
  conversation: RuntimeConversationSummary;
  visitedConversationIds: Set<string>;
}): number {
  const lineage = input.conversation.lineage;
  if (lineage === null) {
    return 0;
  }

  if (input.visitedConversationIds.has(input.conversation.id)) {
    return 1;
  }

  input.visitedConversationIds.add(input.conversation.id);
  if (lineage.parentConversationId === null) {
    return 1;
  }

  const parentConversation = input.conversationsById.get(lineage.parentConversationId);
  if (parentConversation === undefined) {
    return 1;
  }

  return Math.min(
    2,
    1 +
      resolveVisibleLineageDepth({
        conversationsById: input.conversationsById,
        conversation: parentConversation,
        visitedConversationIds: input.visitedConversationIds,
      }),
  );
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
  const conversationsById = new Map(
    input.availableConversations.map((conversation) => [conversation.id, conversation]),
  );

  const rows = sortedConversations.map((conversation) =>
    createNavigatorRow({
      activeConversationId: input.activeConversationId,
      pendingConversationId: input.pendingConversationId,
      pendingServerRequestCountsByConversationId,
      conversationsById,
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
