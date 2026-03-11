import type {
  ChatAssistantEntry,
  ChatCommandEntry,
  ChatEntry,
  ChatExploringGroupEntry,
  ChatFileChangeEntry,
  ChatGenericItemEntry,
  ChatPlanEntry,
  ChatReasoningEntry,
  ChatUserEntry,
} from "./chat-types.js";

export type ChatAssistantBlock =
  | ChatAssistantEntry
  | ChatReasoningEntry
  | ChatCommandEntry
  | ChatPlanEntry
  | ChatFileChangeEntry
  | ChatGenericItemEntry
  | ChatExploringGroupEntry;

export type ChatTurnGroup = {
  turnId: string;
  userEntry: ChatUserEntry | null;
  assistantBlocks: readonly ChatAssistantBlock[];
};

function createTurnGroup(turnId: string): ChatTurnGroup {
  return {
    turnId,
    userEntry: null,
    assistantBlocks: [],
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
      groups[groupIndex] = {
        turnId: group.turnId,
        userEntry: entry,
        assistantBlocks: group.assistantBlocks,
      };
      continue;
    }

    groups[groupIndex] = {
      turnId: group.turnId,
      userEntry: group.userEntry,
      assistantBlocks: [...group.assistantBlocks, entry],
    };
  }

  return groups;
}
