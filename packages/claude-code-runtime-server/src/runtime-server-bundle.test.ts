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
});
