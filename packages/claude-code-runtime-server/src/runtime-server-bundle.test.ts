import { describe, expect, it } from "vitest";

import { ClaudeCodeRuntimeServerBundle } from "./runtime-server-bundle.js";

describe("ClaudeCodeRuntimeServerBundle", () => {
  it("does not request Claude Code bypass permissions because sandboxes run as root", () => {
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("bypassPermissions");
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("allowDangerouslySkipPermissions");
  });

  it("binds omitted Claude Code cwd values to the sandbox workspace root", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain('const defaultWorkspaceRoot = "/root";');
    expect(ClaudeCodeRuntimeServerBundle).toContain("const cwd = resolveClaudeCodeCwd(input.cwd);");
    expect(ClaudeCodeRuntimeServerBundle).toContain("cwd: conversation.cwd,");
  });

  it("allows resumed Claude Code sessions to omit unknown transcript cwd", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("function resolveClaudeCodeLookupCwd");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      'cwd === undefined || cwd === null || cwd === ""',
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("cwd: lookupCwd");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "input.cwd === undefined || input.cwd === null",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("{ cwd: resolveClaudeCodeCwd(input.cwd) }");
  });

  it("records submitted user prompts in the session transcript", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("function appendSubmittedUserQuery");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "appendSubmittedUserQuery(conversation, queryId, inputText);",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain('type: "user"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("text: inputText");
  });

  it("replays idempotent Claude Code session and query results", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("const idempotentResults = new Map();");
    expect(ClaudeCodeRuntimeServerBundle).toContain("function idempotencyKeyForRequest");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      'request.method + ":" + key + ":" + fingerprint',
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "return handleIdempotentRequest(request, () => {",
    );
  });

  it("terminates string-prompt Claude Code queries through the SDK close path", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "const abortController = new AbortController();",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("abortController: input.abortController");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "conversation.activeQueryAbortController.abort();",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("typeof conversation.activeQuery.close");
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("conversation.activeQuery.interrupt");
  });

  it("hydrates resumed Claude Code sessions from persisted SDK transcripts", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("getSessionMessages");
    expect(ClaudeCodeRuntimeServerBundle).toContain("function readConversationQueries");
    expect(ClaudeCodeRuntimeServerBundle).toContain('if (typeof message.content === "string")');
    expect(ClaudeCodeRuntimeServerBundle).toContain("conversation.queries = queries;");
  });

  it("exposes Claude Code sessions and queries instead of Codex thread and turn RPCs", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/create"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/list"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/read"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "query/start"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "query/interrupt"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("listSessions({");
    expect(ClaudeCodeRuntimeServerBundle).not.toContain('case "thread/read"');
    expect(ClaudeCodeRuntimeServerBundle).not.toContain('case "turn/start"');
  });
});
