import { describe, expect, it } from "vitest";

import {
  projectSemanticChatEntries,
  shouldSuppressChatReasoningText,
  type SemanticChatProjectionItem,
} from "./chat-semantic-projection.js";

const ThinkingDisplayKeys = {
  active: "thinking.active",
  completed: "thinking.done",
};

function createThinkingItem(input: {
  id: string;
  turnId: string;
  text: string;
}): SemanticChatProjectionItem {
  return {
    kind: "semantic",
    id: input.id,
    turnId: input.turnId,
    semanticKind: "thinking",
    status: "completed",
    displayKeys: ThinkingDisplayKeys,
    counts: null,
    sourceKind: "reasoning",
    label: "Thought",
    detail: input.text,
    sourcePath: null,
    detailKind: "plain",
    command: null,
    output: null,
  };
}

describe("projectSemanticChatEntries", () => {
  it("groups adjacent semantic items with the same semantic kind", () => {
    const entries = projectSemanticChatEntries([
      createThinkingItem({
        id: "reasoning_1",
        turnId: "turn_1",
        text: "Inspecting state",
      }),
      createThinkingItem({
        id: "reasoning_2",
        turnId: "turn_1",
        text: "Comparing output",
      }),
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        id: "turn_1:thinking:reasoning_1",
        kind: "semantic-group",
        semanticKind: "thinking",
        items: [
          expect.objectContaining({
            id: "reasoning_1",
            detail: "Inspecting state",
          }),
          expect.objectContaining({
            id: "reasoning_2",
            detail: "Comparing output",
          }),
        ],
      }),
    ]);
  });

  it("keeps standalone entries as group boundaries", () => {
    const entries = projectSemanticChatEntries([
      createThinkingItem({
        id: "reasoning_1",
        turnId: "turn_1",
        text: "Before text",
      }),
      {
        kind: "standalone",
        entry: {
          id: "message_1",
          turnId: "turn_1",
          kind: "assistant-message",
          text: "Visible answer",
          phase: null,
          status: "completed",
        },
      },
      createThinkingItem({
        id: "reasoning_2",
        turnId: "turn_1",
        text: "After text",
      }),
    ]);

    expect(entries).toMatchObject([
      {
        id: "turn_1:thinking:reasoning_1",
        kind: "semantic-group",
      },
      {
        id: "message_1",
        kind: "assistant-message",
      },
      {
        id: "turn_1:thinking:reasoning_2",
        kind: "semantic-group",
      },
    ]);
  });
});

describe("shouldSuppressChatReasoningText", () => {
  it("suppresses empty placeholder reasoning text", () => {
    expect(shouldSuppressChatReasoningText("")).toBe(true);
    expect(shouldSuppressChatReasoningText("   ")).toBe(true);
    expect(shouldSuppressChatReasoningText("[]")).toBe(true);
    expect(shouldSuppressChatReasoningText("{}")).toBe(true);
    expect(shouldSuppressChatReasoningText("null")).toBe(true);
  });

  it("keeps non-placeholder reasoning text", () => {
    expect(shouldSuppressChatReasoningText("I will inspect the repository.")).toBe(false);
  });
});
