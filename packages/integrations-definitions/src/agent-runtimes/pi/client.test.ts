import { describe, expect, it } from "vitest";

import { parsePiSessionState } from "./client.js";

describe("Pi session client schemas", () => {
  it("accepts the documented null model state from Pi get_state", () => {
    expect(
      parsePiSessionState({
        isStreaming: false,
        isCompacting: false,
        model: null,
        thinkingLevel: "off",
        sessionFile: "/tmp/session.jsonl",
        sessionId: "session_123",
        messageCount: 0,
        pendingMessageCount: 0,
      }).model,
    ).toBeNull();
  });

  it("requires Pi model payloads to include reasoning support metadata", () => {
    expect(() =>
      parsePiSessionState({
        isStreaming: false,
        isCompacting: false,
        model: {
          id: "gpt-5.2-codex",
          input: ["text", "image"],
          name: "GPT-5.2 Codex",
          provider: "openai-codex",
        },
        thinkingLevel: "medium",
        sessionId: "session_123",
        messageCount: 0,
        pendingMessageCount: 0,
      }),
    ).toThrow("reasoning");
  });

  it("requires Pi get_state payloads to include model state", () => {
    expect(() =>
      parsePiSessionState({
        isStreaming: false,
        isCompacting: false,
        thinkingLevel: "medium",
        sessionId: "session_123",
        messageCount: 0,
        pendingMessageCount: 0,
      }),
    ).toThrow("model");
  });
});
