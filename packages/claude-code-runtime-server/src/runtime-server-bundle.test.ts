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

  it("only interrupts the requested active Claude Code query", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      'throw new Error("query/interrupt requires params.queryId.");',
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "if (conversation.activeQueryId !== params.queryId)",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain('reason: "stale_query"');
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

  it("applies model and reasoning effort through Claude Code SDK query options", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("selectedModel: null");
    expect(ClaudeCodeRuntimeServerBundle).toContain("selectedReasoningEffort: null");
    expect(ClaudeCodeRuntimeServerBundle).toContain("model: conversation.selectedModel");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "reasoningEffort: conversation.selectedReasoningEffort",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "input.model === undefined || input.model === null ? {} : { model: input.model }",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("{ effort: input.reasoningEffort }");
  });

  it("loads Claude Code model catalog lazily through the SDK", () => {
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("const ClaudeCodeModels = [");
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/model-catalog"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("function createIdlePromptStream");
    expect(ClaudeCodeRuntimeServerBundle).toContain("await sdkQuery.supportedModels()");
    expect(ClaudeCodeRuntimeServerBundle).toContain("conversation.modelCatalog = catalog");
    expect(ClaudeCodeRuntimeServerBundle).toContain('isDefault: modelInfo.value === "default"');
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      'displayName: modelInfo.value === "default" ? "Default" : modelInfo.displayName',
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("defaultReasoningEffort: null");
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("isDefault: index === 0");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "availableModels: conversation.modelCatalog ?? []",
    );
  });

  it("loads Claude Code slash command catalog lazily through the SDK", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain("commandCatalog: null");
    expect(ClaudeCodeRuntimeServerBundle).toContain("commandCatalogLoadPromise: null");
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/command-catalog"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("await sdkQuery.supportedCommands()");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "function mapClaudeCodeCommandInfo(commandInfo)",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      'throw new Error("Claude Code returned an invalid slash command catalog entry.");',
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "availableCommands: conversation.commandCatalog ?? []",
    );
  });

  it("updates the cached Claude Code slash command catalog from SDK change events", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain('message.type === "system"');
    expect(ClaudeCodeRuntimeServerBundle).toContain('message.subtype === "commands_changed"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("Array.isArray(message.commands)");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "conversation.commandCatalog = message.commands.map(mapClaudeCodeCommandInfo);",
    );
  });

  it("exposes explicit Claude Code model configuration and context usage RPC state", () => {
    expect(ClaudeCodeRuntimeServerBundle).toContain('case "session/configure"');
    expect(ClaudeCodeRuntimeServerBundle).toContain("function configureSession");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "Claude Code model settings cannot be changed while a query is active.",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "config: buildConversationConfig(conversation)",
    );
    expect(ClaudeCodeRuntimeServerBundle).toContain("contextUsage: conversation.contextUsage");
    expect(ClaudeCodeRuntimeServerBundle).toContain("function updateContextUsageFromResultMessage");
    expect(ClaudeCodeRuntimeServerBundle).toContain(
      "updateContextUsageFromResultMessage(conversation, message);",
    );
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("activeQuery.getContextUsage()");
    expect(ClaudeCodeRuntimeServerBundle).not.toContain("throw contextUsageError;");
    const runQueryBlock = ClaudeCodeRuntimeServerBundle.slice(
      ClaudeCodeRuntimeServerBundle.indexOf("async function runClaudeQuery"),
      ClaudeCodeRuntimeServerBundle.indexOf("function createClaudeQueryOptions"),
    );
    expect(runQueryBlock.indexOf("conversation.activeQueryId = null;")).toBeGreaterThan(
      runQueryBlock.indexOf("finally {"),
    );
  });
});
