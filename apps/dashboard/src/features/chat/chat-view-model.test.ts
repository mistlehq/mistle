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
        contentSegments: [
          {
            kind: "assistant-blocks",
            blocks: [
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
        contentSegments: [
          {
            kind: "assistant-blocks",
            blocks: [
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
        contentSegments: [
          {
            kind: "assistant-blocks",
            blocks: [
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
        ],
      },
    ]);
  });

  it("keeps later user messages in sequence with later assistant content in the same turn", () => {
    const groups = buildChatTurnGroups([
      {
        id: "user-1",
        turnId: "turn-1",
        kind: "user-message",
        text: "initial request",
        status: "completed",
      },
      {
        id: "assistant-1",
        turnId: "turn-1",
        kind: "assistant-message",
        text: "working on it",
        phase: null,
        status: "streaming",
      },
      {
        id: "user-2",
        turnId: "turn-1",
        kind: "user-message",
        label: "Steer",
        labelAction: {
          ariaLabel: "Remove steer message",
          actionId: "steer-1",
        },
        text: "focus on the reducer",
        status: "completed",
      },
      {
        id: "assistant-2",
        turnId: "turn-1",
        kind: "assistant-message",
        text: "reshaping the reducer now",
        phase: null,
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
          text: "initial request",
          status: "completed",
        },
        contentSegments: [
          {
            kind: "assistant-blocks",
            blocks: [
              {
                id: "assistant-1",
                turnId: "turn-1",
                kind: "assistant-message",
                text: "working on it",
                phase: null,
                status: "streaming",
              },
            ],
          },
          {
            kind: "user-message",
            entry: {
              id: "user-2",
              turnId: "turn-1",
              kind: "user-message",
              label: "Steer",
              labelAction: {
                ariaLabel: "Remove steer message",
                actionId: "steer-1",
              },
              text: "focus on the reducer",
              status: "completed",
            },
          },
          {
            kind: "assistant-blocks",
            blocks: [
              {
                id: "assistant-2",
                turnId: "turn-1",
                kind: "assistant-message",
                text: "reshaping the reducer now",
                phase: null,
                status: "streaming",
              },
            ],
          },
        ],
      },
    ]);
  });
});
