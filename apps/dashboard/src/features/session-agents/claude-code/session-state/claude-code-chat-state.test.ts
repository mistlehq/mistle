import { describe, expect, it } from "vitest";

import {
  createInitialClaudeCodeChatState,
  reduceClaudeCodeChatState,
} from "./claude-code-chat-state.js";

const ClaudeCodeTestSessionConfig = {
  availableModels: [],
  model: null,
  modelReasoningEffort: null,
};

describe("reduceClaudeCodeChatState", () => {
  it("keeps a submitted Claude Code prompt visible after hydrating the active session", () => {
    const submittedState = reduceClaudeCodeChatState(createInitialClaudeCodeChatState(), {
      type: "prompt_submitted",
      queryId: "query_123",
      sessionId: "session_123",
      submittedPrompt: "Inspect the failing tests",
    });

    const hydratedState = reduceClaudeCodeChatState(submittedState, {
      type: "hydrate_session",
      session: {
        id: "session_123",
        activeQueryId: "query_123",
        config: ClaudeCodeTestSessionConfig,
        contextUsage: null,
        cwd: "/root",
        lastError: null,
        status: {
          type: "active",
        },
        queries: [
          {
            queryId: "query_123",
            message: {
              type: "user",
              text: "Inspect the failing tests",
            },
          },
        ],
      },
    });

    expect(hydratedState.entries).toEqual([
      {
        id: "session_123:user:query_123:0",
        kind: "user-message",
        status: "completed",
        text: "Inspect the failing tests",
        turnId: "query_123",
      },
    ]);
  });

  it("renders user and assistant messages from a hydrated Claude Code session", () => {
    const hydratedState = reduceClaudeCodeChatState(createInitialClaudeCodeChatState(), {
      type: "hydrate_session",
      session: {
        id: "session_456",
        activeQueryId: null,
        config: ClaudeCodeTestSessionConfig,
        contextUsage: null,
        cwd: "/root",
        lastError: null,
        status: {
          type: "idle",
        },
        queries: [
          {
            queryId: "query_456",
            message: {
              type: "user",
              text: "Summarize the repository",
            },
          },
          {
            queryId: "query_456",
            message: {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "text",
                    text: "This repository contains the Mistle app.",
                  },
                ],
              },
            },
          },
        ],
      },
    });

    expect(hydratedState.entries).toEqual([
      {
        id: "session_456:user:query_456:0",
        kind: "user-message",
        status: "completed",
        text: "Summarize the repository",
        turnId: "query_456",
      },
      {
        id: "session_456:assistant:1",
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: "This repository contains the Mistle app.",
        turnId: "query_456",
      },
    ]);
  });
});
