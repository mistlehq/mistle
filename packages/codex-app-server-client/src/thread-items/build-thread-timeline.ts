import type { CodexThreadReadTurn } from "../codex/operations.js";
import { classifyCodexThreadItemSemantics } from "./classify-thread-item-semantics.js";
import { normalizeCodexThreadItem } from "./normalize-thread-item.js";
import type {
  ClassifiedCodexThreadItem,
  CodexTimelineEntry,
  SemanticActionGroup,
} from "./types.js";

function flushExploringGroup(
  entries: CodexTimelineEntry[],
  groupItems: ClassifiedCodexThreadItem[],
  turnId: string,
): void {
  if (groupItems.length === 0) {
    return;
  }

  const firstItem = groupItems[0];
  if (firstItem === undefined) {
    throw new Error(`Missing first item for exploring group in turn '${turnId}'.`);
  }

  const group: SemanticActionGroup = {
    id: `${turnId}:exploring:${firstItem.item.id}`,
    kind: "exploring",
    status: groupItems.some((item) => item.status === "streaming") ? "streaming" : "completed",
    displayKeys: firstItem.displayKeys,
    counts: groupItems.reduce(
      (counts, item) => ({
        reads: counts.reads + (item.summaryCounts?.reads ?? 0),
        searches: counts.searches + (item.summaryCounts?.searches ?? 0),
        lists: counts.lists + (item.summaryCounts?.lists ?? 0),
      }),
      {
        reads: 0,
        searches: 0,
        lists: 0,
      },
    ),
    items: groupItems.map((item) => item.item),
  };
  entries.push(group);
}

function buildTurnTimelineFromNormalized(input: {
  turnId: string;
  items: readonly import("./types.js").NormalizedCodexThreadItem[];
}): readonly CodexTimelineEntry[] {
  const entries: CodexTimelineEntry[] = [];
  let currentExploringGroup: ClassifiedCodexThreadItem[] = [];

  for (const item of input.items) {
    const classified = classifyCodexThreadItemSemantics(item);
    if (classified.semanticKind === "exploring") {
      currentExploringGroup.push(classified);
      continue;
    }

    flushExploringGroup(entries, currentExploringGroup, input.turnId);
    currentExploringGroup = [];
    entries.push({
      id: classified.item.id,
      item: classified.item,
      semanticKind: classified.semanticKind,
      status: classified.status,
      displayKeys: classified.displayKeys,
    });
  }

  flushExploringGroup(entries, currentExploringGroup, input.turnId);
  return entries;
}

export function buildCodexTurnTimeline(input: {
  turn: CodexThreadReadTurn;
}): readonly CodexTimelineEntry[] {
  const normalizedItems = input.turn.items.flatMap((item) =>
    normalizeCodexThreadItem({
      turnId: input.turn.id,
      item,
    }),
  );

  return buildTurnTimelineFromNormalized({
    turnId: input.turn.id,
    items: normalizedItems,
  });
}

export function buildCodexThreadTimeline(input: {
  turns: readonly CodexThreadReadTurn[];
}): readonly CodexTimelineEntry[] {
  return input.turns.flatMap((turn) => buildCodexTurnTimeline({ turn }));
}

export function buildCodexTurnTimelineFromNormalized(input: {
  turnId: string;
  items: readonly import("./types.js").NormalizedCodexThreadItem[];
}): readonly CodexTimelineEntry[] {
  return buildTurnTimelineFromNormalized(input);
}
