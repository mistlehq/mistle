import type {
  ChatAssistantEntry,
  ChatCommandEntry,
  ChatEntry,
  ChatFileChangeEntry,
  ChatGenericItemEntry,
  ChatPlanEntry,
  ChatReasoningEntry,
  ChatSemanticGroupEntry,
  ChatUserEntry,
} from "./chat-types.js";

export type ChatAssistantBlock =
  | ChatAssistantEntry
  | ChatReasoningEntry
  | ChatCommandEntry
  | ChatPlanEntry
  | ChatFileChangeEntry
  | ChatGenericItemEntry
  | ChatSemanticGroupEntry;

export type ChatTurnContentSegment =
  | {
      kind: "assistant-blocks";
      blocks: readonly ChatAssistantBlock[];
    }
  | {
      kind: "user-message";
      entry: ChatUserEntry;
    };

export type ChatTurnGroup = {
  turnId: string;
  userEntry: ChatUserEntry | null;
  contentSegments: readonly ChatTurnContentSegment[];
};

function createTurnGroup(turnId: string): ChatTurnGroup {
  return {
    turnId,
    userEntry: null,
    contentSegments: [],
  };
}

export function buildChatTurnGroups(entries: readonly ChatEntry[]): readonly ChatTurnGroup[] {
  const groups: ChatTurnGroup[] = [];
  const groupIndexesByTurnId = new Map<string, number>();

  for (const entry of entries) {
    const existingGroupIndex = groupIndexesByTurnId.get(entry.turnId);
    const groupIndex =
      existingGroupIndex ??
      (() => {
        const nextGroupIndex = groups.length;
        groups.push(createTurnGroup(entry.turnId));
        groupIndexesByTurnId.set(entry.turnId, nextGroupIndex);
        return nextGroupIndex;
      })();
    const group = groups[groupIndex];
    if (group === undefined) {
      throw new Error(`Missing chat turn group for ${entry.turnId}.`);
    }

    if (entry.kind === "user-message") {
      if (group.userEntry === null) {
        groups[groupIndex] = {
          turnId: group.turnId,
          userEntry: entry,
          contentSegments: group.contentSegments,
        };
        continue;
      }

      groups[groupIndex] = {
        turnId: group.turnId,
        userEntry: group.userEntry,
        contentSegments: [...group.contentSegments, { kind: "user-message", entry }],
      };
      continue;
    }

    const lastSegment = group.contentSegments.at(-1);
    const nextContentSegments =
      lastSegment?.kind === "assistant-blocks"
        ? [
            ...group.contentSegments.slice(0, -1),
            {
              kind: "assistant-blocks" as const,
              blocks: [...lastSegment.blocks, entry],
            },
          ]
        : [...group.contentSegments, { kind: "assistant-blocks" as const, blocks: [entry] }];

    groups[groupIndex] = {
      turnId: group.turnId,
      userEntry: group.userEntry,
      contentSegments: nextContentSegments,
    };
  }

  return groups;
}
