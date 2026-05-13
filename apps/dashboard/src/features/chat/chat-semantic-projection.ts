import type { ChatEntry, ChatSemanticGroupEntry } from "./chat-types.js";

export function formatSemanticChatDetail(input: {
  detail: string | null;
  maxLength: number;
}): string | null {
  if (input.detail === null) {
    return null;
  }

  const normalizedDetail = input.detail.replaceAll(/\s+/g, " ").trim();
  if (normalizedDetail.length === 0) {
    return null;
  }

  if (normalizedDetail.length <= input.maxLength) {
    return normalizedDetail;
  }

  return `${normalizedDetail.slice(0, input.maxLength - 1).trimEnd()}…`;
}

export function shouldSuppressChatReasoningText(text: string): boolean {
  const normalizedText = text.trim();
  return (
    normalizedText.length === 0 ||
    normalizedText === "[]" ||
    normalizedText === "{}" ||
    normalizedText === "null"
  );
}

export type SemanticChatProjectionItem =
  | {
      kind: "semantic";
      id: string;
      turnId: string;
      semanticKind: ChatSemanticGroupEntry["semanticKind"];
      status: ChatSemanticGroupEntry["status"];
      displayKeys: ChatSemanticGroupEntry["displayKeys"];
      counts: ChatSemanticGroupEntry["counts"];
      sourceKind: ChatSemanticGroupEntry["items"][number]["sourceKind"];
      label: string;
      detail: string | null;
      sourcePath: string | null;
      detailKind: ChatSemanticGroupEntry["items"][number]["detailKind"];
      command: string | null;
      output: string | null;
    }
  | {
      kind: "standalone";
      entry: ChatEntry;
    };

function mergeExploringCounts(
  items: readonly Extract<SemanticChatProjectionItem, { kind: "semantic" }>[],
): ChatSemanticGroupEntry["counts"] {
  return items.reduce(
    (counts, item) => ({
      reads: counts.reads + (item.counts?.reads ?? 0),
      searches: counts.searches + (item.counts?.searches ?? 0),
      lists: counts.lists + (item.counts?.lists ?? 0),
    }),
    {
      reads: 0,
      searches: 0,
      lists: 0,
    },
  );
}

function buildSemanticGroup(
  items: readonly Extract<SemanticChatProjectionItem, { kind: "semantic" }>[],
): ChatSemanticGroupEntry {
  const firstItem = items[0];
  if (firstItem === undefined) {
    throw new Error("Cannot build an empty semantic chat group.");
  }

  const counts = firstItem.semanticKind === "exploring" ? mergeExploringCounts(items) : null;

  return {
    id: `${firstItem.turnId}:${firstItem.semanticKind}:${firstItem.id}`,
    turnId: firstItem.turnId,
    kind: "semantic-group",
    semanticKind: firstItem.semanticKind,
    status: items.some((item) => item.status === "streaming") ? "streaming" : "completed",
    displayKeys: firstItem.displayKeys,
    counts,
    items: items.map((item) => ({
      id: item.id,
      sourceKind: item.sourceKind,
      label: item.label,
      detail: item.detail,
      ...(item.sourcePath === null ? {} : { sourcePath: item.sourcePath }),
      detailKind: item.detailKind,
      command: item.command,
      output: item.output,
      status: item.status,
    })),
  };
}

export function projectSemanticChatEntries(
  items: readonly SemanticChatProjectionItem[],
): readonly ChatEntry[] {
  const entries: ChatEntry[] = [];
  let currentGroup: Extract<SemanticChatProjectionItem, { kind: "semantic" }>[] = [];

  function flushCurrentGroup(): void {
    if (currentGroup.length === 0) {
      return;
    }

    entries.push(buildSemanticGroup(currentGroup));
    currentGroup = [];
  }

  for (const item of items) {
    if (item.kind === "standalone") {
      flushCurrentGroup();
      entries.push(item.entry);
      continue;
    }

    const currentGroupKind = currentGroup[0]?.semanticKind ?? null;
    if (currentGroupKind === null || currentGroupKind === item.semanticKind) {
      currentGroup.push(item);
      continue;
    }

    flushCurrentGroup();
    currentGroup.push(item);
  }

  flushCurrentGroup();
  return entries;
}
