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
    expect(ClaudeCodeRuntimeServerBundle).toContain("cwd: resolveClaudeCodeCwd(input.cwd),");
    expect(ClaudeCodeRuntimeServerBundle).toContain("cwd: conversation.cwd,");
  });

  it("records submitted user prompts in the session transcript", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("function appendSubmittedUserQuery");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "appendSubmittedUserQuery(conversation, queryId, inputText);",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain('type: "user"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("text: inputText");
  });

  it("exposes Claude Code sessions and queries instead of Codex thread and turn RPCs", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/create"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/read"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "query/start"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "query/interrupt"');
    expect(ClaudeCodeRuntimeServerBundle).not.toContain('case "thread/read"');
    expect(ClaudeCodeRuntimeServerBundle).not.toContain('case "turn/start"');
  });
});
