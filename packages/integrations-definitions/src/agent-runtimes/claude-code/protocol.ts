export const ClaudeCodeRuntimeMethods = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  PERMISSION_REPLY: "permission/reply",
  QUERY_INTERRUPT: "query/interrupt",
  QUERY_START: "query/start",
  QUERY_STEER: "query/steer",
  SESSION_COMMAND_CATALOG: "session/command-catalog",
  SESSION_CONFIGURE: "session/configure",
  SESSION_CREATE: "session/create",
  SESSION_LIST: "session/list",
  SESSION_MODEL_CATALOG: "session/model-catalog",
  SESSION_READ: "session/read",
  SESSION_RESUME: "session/resume",
  TITLE_GENERATE: "title/generate",
} as const;

export function isClaudeCodeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readClaudeCodeNestedString(value: unknown, path: readonly string[]): string | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isClaudeCodeRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return typeof currentValue === "string" && currentValue.length > 0 ? currentValue : null;
}

export function extractClaudeCodeSessionId(result: unknown, method: string): string {
  const sessionId = readClaudeCodeNestedString(result, ["session", "id"]);
  if (sessionId === null) {
    throw new Error(`Claude Code ${method} response did not include session.id.`);
  }
  return sessionId;
}

export function extractClaudeCodeQueryId(result: unknown, method: string): string {
  const queryId =
    readClaudeCodeNestedString(result, ["query", "id"]) ??
    readClaudeCodeNestedString(result, ["queryId"]);
  if (queryId === null) {
    throw new Error(`Claude Code ${method} response did not include query id.`);
  }
  return queryId;
}
