import { describe, expect, it } from "vitest";

import type { PiConversationSummary } from "./client.js";
import { resolveOriginalPiConversationId } from "./conversation-provider.server.js";

describe("resolveOriginalPiConversationId", () => {
  it("selects the earliest conversation by created timestamp", () => {
    expect(
      resolveOriginalPiConversationId([
        piConversation({ id: "conversation_recent", createdAt: "2026-03-09T12:00:00.000Z" }),
        piConversation({ id: "conversation_original", createdAt: "2026-03-09T09:00:00.000Z" }),
        piConversation({ id: "conversation_middle", createdAt: "2026-03-09T10:00:00.000Z" }),
      ]),
    ).toBe("conversation_original");
  });

  it("breaks equal timestamp ties by stable conversation id ordering", () => {
    expect(
      resolveOriginalPiConversationId([
        piConversation({ id: "conversation_b", createdAt: "2026-03-09T09:00:00.000Z" }),
        piConversation({ id: "conversation_a", createdAt: "2026-03-09T09:00:00.000Z" }),
      ]),
    ).toBe("conversation_a");
  });

  it("ignores conversations without a usable created timestamp", () => {
    expect(
      resolveOriginalPiConversationId([
        piConversation({ id: "conversation_missing", createdAt: null }),
        piConversation({ id: "conversation_invalid", createdAt: "not-a-date" }),
        piConversation({ id: "conversation_original", createdAt: "2026-03-09T09:00:00.000Z" }),
      ]),
    ).toBe("conversation_original");
  });
});

function piConversation(input: { id: string; createdAt: string | null }): PiConversationSummary {
  return {
    id: input.id,
    sessionFile: `${input.id}.json`,
    cwd: "/root/repo",
    title: input.id,
    createdAt: input.createdAt,
    updatedAt: null,
  };
}
