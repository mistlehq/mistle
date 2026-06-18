import type { ChatEntry } from "../chat/chat-types.js";
import type { ServerRequestEntry } from "../session-agents/server-requests/index.js";

export function filterUnmatchedSessionServerRequests(input: {
  chatEntries: readonly ChatEntry[];
  pendingServerRequests: readonly ServerRequestEntry[];
}): readonly ServerRequestEntry[] {
  const chatItemIds = new Set(
    input.chatEntries.flatMap((entry) => {
      if (entry.kind === "semantic-group") {
        return entry.items.map((item) => item.id);
      }

      if (entry.kind === "command-execution" || entry.kind === "file-change") {
        return [entry.id];
      }

      return [];
    }),
  );

  return input.pendingServerRequests.filter((entry) => {
    if (entry.kind !== "command-approval" && entry.kind !== "file-change-approval") {
      return true;
    }

    return !chatItemIds.has(entry.itemId);
  });
}
