import { describe, expect, it } from "vitest";

import {
  buildClaudeCodeQuerySteerParams,
  ClaudeCodeRuntimeMethods,
  extractClaudeCodeQueryId,
  extractClaudeCodeSessionId,
} from "./protocol.js";

describe("extractClaudeCodeSessionId", () => {
  it("reads session ids from Claude Code session responses", () => {
    expect(
      extractClaudeCodeSessionId(
        {
          session: {
            id: "session_123",
          },
        },
        ClaudeCodeRuntimeMethods.SESSION_CREATE,
      ),
    ).toBe("session_123");
  });

  it("rejects session responses without session ids", () => {
    expect(() => extractClaudeCodeSessionId({}, ClaudeCodeRuntimeMethods.SESSION_CREATE)).toThrow(
      "Claude Code session/create response did not include session.id.",
    );
  });
});

describe("extractClaudeCodeQueryId", () => {
  it("reads query ids from nested query responses", () => {
    expect(
      extractClaudeCodeQueryId(
        {
          query: {
            id: "query_123",
          },
        },
        ClaudeCodeRuntimeMethods.QUERY_START,
      ),
    ).toBe("query_123");
  });

  it("preserves support for flat query id responses", () => {
    expect(
      extractClaudeCodeQueryId(
        {
          queryId: "query_123",
        },
        ClaudeCodeRuntimeMethods.QUERY_STEER,
      ),
    ).toBe("query_123");
  });

  it("rejects query responses without query ids", () => {
    expect(() => extractClaudeCodeQueryId({}, ClaudeCodeRuntimeMethods.QUERY_START)).toThrow(
      "Claude Code query/start response did not include query id.",
    );
  });
});

describe("buildClaudeCodeQuerySteerParams", () => {
  it("includes the expected active query id for Claude Code query steering", () => {
    expect(
      buildClaudeCodeQuerySteerParams({
        sessionId: "session_123",
        expectedQueryId: "query_123",
        inputText: "Adjust the current run.",
      }),
    ).toEqual({
      sessionId: "session_123",
      expectedQueryId: "query_123",
      inputText: "Adjust the current run.",
    });
  });
});
