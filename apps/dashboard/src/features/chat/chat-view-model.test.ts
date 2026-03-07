import { describe, expect, it } from "vitest";

import { buildChatTurnGroups } from "./chat-view-model.js";

describe("buildChatTurnGroups", () => {
  it("groups user and assistant entries by turn id in appearance order", () => {
    const groups = buildChatTurnGroups([
      {
        id: "user-1",
        turnId: "turn-1",
        kind: "user-message",
        text: "tell me a story",
        status: "completed",
      },
      {
        id: "assistant-1",
        turnId: "turn-1",
        kind: "assistant-message",
        text: "Once upon a time",
        phase: "final_answer",
        status: "completed",
      },
      {
        id: "reasoning-1",
        turnId: "turn-1",
        kind: "reasoning",
        summary: "Considering structure",
        source: "summary",
        status: "completed",
      },
      {
        id: "user-2",
        turnId: "turn-2",
        kind: "user-message",
        text: "what is in the main directory",
        status: "completed",
      },
      {
        id: "assistant-2",
        turnId: "turn-2",
        kind: "assistant-message",
        text: "I'm checking the workspace root contents.",
        phase: "commentary",
        status: "streaming",
      },
    ]);

    expect(groups).toEqual([
      {
        turnId: "turn-1",
        userEntry: {
          id: "user-1",
          turnId: "turn-1",
          kind: "user-message",
          text: "tell me a story",
          status: "completed",
        },
        assistantBlocks: [
          {
            id: "assistant-1",
            turnId: "turn-1",
            kind: "assistant-message",
            text: "Once upon a time",
            phase: "final_answer",
            status: "completed",
          },
          {
            id: "reasoning-1",
            turnId: "turn-1",
            kind: "reasoning",
            summary: "Considering structure",
            source: "summary",
            status: "completed",
          },
        ],
      },
      {
        turnId: "turn-2",
        userEntry: {
          id: "user-2",
          turnId: "turn-2",
          kind: "user-message",
          text: "what is in the main directory",
          status: "completed",
        },
        assistantBlocks: [
          {
            id: "assistant-2",
            turnId: "turn-2",
            kind: "assistant-message",
            text: "I'm checking the workspace root contents.",
            phase: "commentary",
            status: "streaming",
          },
        ],
      },
    ]);
  });

  it("creates assistant-only groups when a turn has no user entry yet", () => {
    const groups = buildChatTurnGroups([
      {
        id: "assistant-1",
        turnId: "turn-1",
        kind: "assistant-message",
        text: "Streaming reply",
        phase: null,
        status: "streaming",
      },
    ]);

    expect(groups).toEqual([
      {
        turnId: "turn-1",
        userEntry: null,
        assistantBlocks: [
          {
            id: "assistant-1",
            turnId: "turn-1",
            kind: "assistant-message",
            text: "Streaming reply",
            phase: null,
            status: "streaming",
          },
        ],
      },
    ]);
  });
});
