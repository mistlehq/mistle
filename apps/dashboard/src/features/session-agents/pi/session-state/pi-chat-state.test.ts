import { describe, expect, it } from "vitest";

import type { ChatEntry, ChatSemanticGroupEntry } from "../../../chat/chat-types.js";
import { createInitialPiChatState, reducePiChatState } from "./pi-chat-state.js";

function findSemanticGroup(input: {
  entries: readonly ChatEntry[];
  semanticKind: ChatSemanticGroupEntry["semanticKind"];
}): ChatSemanticGroupEntry {
  const group = input.entries.find(
    (entry): entry is ChatSemanticGroupEntry =>
      entry.kind === "semantic-group" && entry.semanticKind === input.semanticKind,
  );
  if (group === undefined) {
    throw new Error(`Expected ${input.semanticKind} semantic group.`);
  }
  return group;
}

describe("reducePiChatState", () => {
  it("keeps hydrated Pi history when a run completes", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      messages: [
        {
          role: "user",
          content: "previous question",
          timestamp: 1,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "previous answer" }],
          timestamp: 2,
        },
      ],
    });

    const submittedState = reducePiChatState(hydratedState, {
      type: "prompt_submitted",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      submittedPrompt: "hello",
    });
    const userEndedState = reducePiChatState(submittedState, {
      type: "event_received",
      event: {
        type: "message_end",
        message: {
          role: "user",
          content: "hello",
          timestamp: 3,
        },
      },
    });
    const assistantEndedState = reducePiChatState(userEndedState, {
      type: "event_received",
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi there" }],
          timestamp: 4,
        },
      },
    });
    const completedState = reducePiChatState(assistantEndedState, {
      type: "event_received",
      event: {
        type: "agent_end",
        messages: [
          {
            role: "user",
            content: "hello",
            timestamp: 3,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "hi there" }],
            timestamp: 4,
          },
        ],
      },
    });

    expect(completedState.messages).toEqual([
      {
        role: "user",
        content: "previous question",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "previous answer" }],
        timestamp: 2,
      },
      {
        role: "user",
        content: "hello",
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
        timestamp: 4,
      },
    ]);
    expect(completedState.status).toBe("idle");
    expect(completedState.pendingTurnId).toBeNull();
  });

  it("projects live Pi tool execution events into chat semantic groups", () => {
    const submittedState = reducePiChatState(createInitialPiChatState(), {
      type: "prompt_submitted",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      submittedPrompt: "check the package",
    });
    const startedState = reducePiChatState(submittedState, {
      type: "event_received",
      event: {
        type: "tool_execution_start",
        toolCallId: "tool_1",
        toolName: "bash",
        args: {
          command: "pnpm test",
        },
      },
    });
    const updatedState = reducePiChatState(startedState, {
      type: "event_received",
      event: {
        type: "tool_execution_update",
        toolCallId: "tool_1",
        toolName: "bash",
        args: {
          command: "pnpm test",
        },
        partialResult: {
          content: [{ type: "text", text: "running tests" }],
        },
      },
    });

    const group = findSemanticGroup({
      entries: updatedState.entries,
      semanticKind: "running-commands",
    });
    expect(group.status).toBe("streaming");
    expect(group.items).toEqual([
      expect.objectContaining({
        command: "pnpm test",
        detail: "pnpm test",
        label: "Command",
        output: "running tests",
        status: "streaming",
      }),
    ]);
  });

  it("applies buffered Pi events after hydrated messages", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      messages: [
        {
          role: "user",
          content: "check the package",
          timestamp: 1,
        },
      ],
      bufferedEvents: [
        {
          type: "tool_execution_start",
          toolCallId: "tool_1",
          toolName: "bash",
          args: {
            command: "pnpm test",
          },
        },
      ],
    });

    const group = findSemanticGroup({
      entries: hydratedState.entries,
      semanticKind: "running-commands",
    });
    expect(hydratedState.status).toBe("busy");
    expect(group.status).toBe("streaming");
    expect(group.items).toEqual([
      expect.objectContaining({
        command: "pnpm test",
        detail: "pnpm test",
        label: "Command",
        status: "streaming",
      }),
    ]);
  });

  it("preserves active Pi state while hydrating a resumed conversation", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      status: "busy",
      messages: [
        {
          role: "user",
          content: "continue the active task",
          timestamp: 1,
        },
      ],
    });

    expect(hydratedState.status).toBe("busy");
    expect(hydratedState.entries).toEqual([
      expect.objectContaining({
        kind: "user-message",
        status: "completed",
        text: "continue the active task",
      }),
    ]);
  });

  it("projects empty Pi file markers as user message attachments", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      messages: [
        {
          role: "user",
          content:
            'Review these\n\n<file name="/root/.local/attachments/ses_test/screen shot.png"></file>\n<file name="/root/.local/attachments/ses_test/requirements.pdf"></file>',
          timestamp: 1,
        },
      ],
    });

    expect(hydratedState.entries).toEqual([
      expect.objectContaining({
        kind: "user-message",
        text: "Review these",
        attachments: [
          {
            kind: "image",
            name: "screen shot.png",
            path: "/root/.local/attachments/ses_test/screen shot.png",
          },
          {
            kind: "file",
            name: "requirements.pdf",
            path: "/root/.local/attachments/ses_test/requirements.pdf",
          },
        ],
      }),
    ]);
  });

  it("keeps non-empty Pi file marker content visible", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      messages: [
        {
          role: "user",
          content: '<file name="/workspace/notes.txt">Important note</file>',
          timestamp: 1,
        },
      ],
    });

    expect(hydratedState.entries).toEqual([
      expect.objectContaining({
        kind: "user-message",
        text: '<file name="/workspace/notes.txt">Important note</file>',
      }),
    ]);
  });

  it("merges final Pi messages from the agent-end event", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      messages: [
        {
          role: "user",
          content: "previous question",
          timestamp: 1,
        },
      ],
    });
    const submittedState = reducePiChatState(hydratedState, {
      type: "prompt_submitted",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      submittedPrompt: "hello",
    });

    const completedState = reducePiChatState(submittedState, {
      type: "event_received",
      event: {
        type: "agent_end",
        messages: [
          {
            role: "user",
            content: "hello",
            timestamp: 2,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "hi there" }],
            timestamp: 3,
          },
        ],
      },
    });

    expect(completedState.messages).toEqual([
      {
        role: "user",
        content: "previous question",
        timestamp: 1,
      },
      {
        role: "user",
        content: "hello",
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
        timestamp: 3,
      },
    ]);
    expect(completedState.status).toBe("idle");
    expect(completedState.pendingTurnId).toBeNull();
  });

  it("rebuilds completed Pi tool semantic groups from persisted transcript messages", () => {
    const hydratedState = reducePiChatState(createInitialPiChatState(), {
      type: "hydrate_messages",
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tool_1",
              name: "read",
              arguments: {
                path: "package.json",
              },
            },
          ],
          timestamp: 1,
        },
        {
          role: "toolResult",
          toolCallId: "tool_1",
          toolName: "read",
          content: [{ type: "text", text: '{ "name": "mistle" }' }],
          timestamp: 2,
        },
      ],
    });

    const group = findSemanticGroup({
      entries: hydratedState.entries,
      semanticKind: "exploring",
    });
    expect(group.status).toBe("completed");
    expect(group.counts).toEqual({
      lists: 0,
      reads: 1,
      searches: 0,
    });
    expect(group.items).toEqual([
      expect.objectContaining({
        detail: "package.json",
        label: "Read",
        output: '{ "name": "mistle" }',
        status: "completed",
      }),
    ]);
  });
});
