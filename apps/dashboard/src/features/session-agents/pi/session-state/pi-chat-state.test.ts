import { describe, expect, it } from "vitest";

import { createInitialPiChatState, reducePiChatState } from "./pi-chat-state.js";

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
});
