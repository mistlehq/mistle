import { describe, expect, it } from "vitest";

import {
  parsePiExtensionUIRequest,
  parsePiExtensionUIResponseInput,
  parsePiSessionState,
} from "./client.js";

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

  it("accepts Pi get_state context window usage when present", () => {
    expect(
      parsePiSessionState({
        isStreaming: false,
        isCompacting: false,
        model: null,
        thinkingLevel: "off",
        sessionFile: "/tmp/session.jsonl",
        sessionId: "session_123",
        messageCount: 1,
        pendingMessageCount: 0,
        contextUsage: {
          tokens: null,
          contextWindow: 200_000,
          percent: null,
        },
      }).contextUsage,
    ).toEqual({
      tokens: null,
      contextWindow: 200_000,
      percent: null,
    });
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

describe("Pi extension UI request schemas", () => {
  it("parses Pi confirm requests from the latest RPC protocol", () => {
    expect(
      parsePiExtensionUIRequest({
        type: "extension_ui_request",
        id: "ui_confirm_1",
        method: "confirm",
        title: "Run command?",
        message: "Allow bash command?",
        timeout: 30_000,
      }),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui_confirm_1",
      method: "confirm",
      title: "Run command?",
      message: "Allow bash command?",
      timeout: 30_000,
    });
  });

  it("ignores non-extension UI Pi events", () => {
    expect(
      parsePiExtensionUIRequest({
        type: "agent_start",
      }),
    ).toBeNull();
  });

  it("rejects malformed Pi extension UI requests", () => {
    expect(() =>
      parsePiExtensionUIRequest({
        type: "extension_ui_request",
        id: "ui_select_1",
        method: "select",
        title: "Choose model",
        options: [],
      }),
    ).toThrow("Too small");
  });

  it("rejects ambiguous Pi extension UI response inputs", () => {
    expect(() =>
      parsePiExtensionUIResponseInput({
        requestId: "ui_confirm_1",
        value: "yes",
        confirmed: true,
      }),
    ).toThrow("Unrecognized key");
  });
});
