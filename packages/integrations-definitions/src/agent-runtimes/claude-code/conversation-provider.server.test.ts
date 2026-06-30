import { describe, expect, it } from "vitest";

import {
  buildClaudeCodeCreateSessionParams,
  buildClaudeCodeStartQueryParams,
  buildClaudeCodeSteerQueryParams,
} from "./conversation-provider.server.js";

describe("buildClaudeCodeCreateSessionParams", () => {
  it("includes the cwd supported by the Claude Code runtime server", () => {
    expect(
      buildClaudeCodeCreateSessionParams({
        cwd: "/root/workspace",
      }),
    ).toEqual({
      cwd: "/root/workspace",
    });
  });

  it("omits unsupported create-conversation options", () => {
    expect(
      buildClaudeCodeCreateSessionParams({
        cwd: "/root/workspace",
        options: {
          model: "claude-sonnet-4-5",
          modelReasoningEffort: "high",
        },
      }),
    ).toEqual({
      cwd: "/root/workspace",
    });
  });
});

describe("buildClaudeCodeStartQueryParams", () => {
  it("includes the start-query params supported by the Claude Code runtime server", () => {
    expect(
      buildClaudeCodeStartQueryParams({
        providerConversationId: "session_123",
        inputText: "Handle this event.",
      }),
    ).toEqual({
      sessionId: "session_123",
      inputText: "Handle this event.",
    });
  });

  it("omits unsupported collaboration mode settings", () => {
    expect(
      buildClaudeCodeStartQueryParams({
        providerConversationId: "session_123",
        inputText: "Handle this event.",
        collaborationModeSettings: {
          developerInstructions: "Always include a reproducible next step.",
        },
      }),
    ).toEqual({
      sessionId: "session_123",
      inputText: "Handle this event.",
    });
  });
});

describe("buildClaudeCodeSteerQueryParams", () => {
  it("includes the provider execution id as the expected active query id", () => {
    expect(
      buildClaudeCodeSteerQueryParams({
        providerConversationId: "session_123",
        providerExecutionId: "query_123",
        inputText: "Adjust the current run.",
      }),
    ).toEqual({
      sessionId: "session_123",
      expectedQueryId: "query_123",
      inputText: "Adjust the current run.",
    });
  });
});
