import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { AgentStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";

export type ClaudeCodeSessionStatus = "active" | "error" | "idle" | "notLoaded";

export type ClaudeCodeSessionQuery = {
  queryId: string;
  message: unknown;
};

export type ClaudeCodeSessionReadResult = {
  session: {
    activeQueryId: string | null;
    cwd: string | null;
    id: string;
    lastError: string | null;
    queries: readonly ClaudeCodeSessionQuery[];
    status: {
      type: ClaudeCodeSessionStatus;
    };
  };
};

export type ClaudeCodeSessionSummary = {
  createdAt: number | null;
  cwd: string | null;
  id: string;
  title: string;
  updatedAt: number;
};

export type ClaudeCodeSessionClient = {
  close(): void;
  connect(): Promise<void>;
  createSession(input?: {
    cwd?: string | null;
    idempotency?: AgentConversationIdempotencyMetadata;
  }): Promise<{ sessionId: string }>;
  interruptQuery(input: { sessionId: string }): Promise<void>;
  listSessions(input?: {
    cwd?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<readonly ClaudeCodeSessionSummary[]>;
  readSession(input: { sessionId: string }): Promise<ClaudeCodeSessionReadResult>;
  resumeSession(input: { cwd?: string | null; sessionId: string }): Promise<void>;
  startQuery(input: {
    idempotency?: AgentConversationIdempotencyMetadata;
    inputText: string;
    sessionId: string;
  }): Promise<{ queryId: string }>;
  steerQuery(input: {
    idempotency?: AgentConversationIdempotencyMetadata;
    inputText: string;
    sessionId: string;
  }): Promise<{ queryId: string }>;
};

export type ClaudeCodeSessionClientInput = {
  transport: SandboxSessionTransport;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedRecord(value: unknown, path: readonly string[]): Record<string, unknown> | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return isRecord(currentValue) ? currentValue : null;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return typeof currentValue === "string" && currentValue.length > 0 ? currentValue : null;
}

function readNestedStringValue(value: unknown, path: readonly string[]): string | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return typeof currentValue === "string" ? currentValue : null;
}

function readNestedNumber(value: unknown, path: readonly string[]): number | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return typeof currentValue === "number" && Number.isFinite(currentValue) ? currentValue : null;
}

function extractSessionId(result: unknown, method: string): string {
  const sessionId = readNestedString(result, ["session", "id"]);
  if (sessionId === null) {
    throw new Error(`Claude Code ${method} response did not include session.id.`);
  }
  return sessionId;
}

function extractQueryId(result: unknown, method: string): string {
  const queryId =
    readNestedString(result, ["query", "id"]) ?? readNestedString(result, ["queryId"]);
  if (queryId === null) {
    throw new Error(`Claude Code ${method} response did not include query id.`);
  }
  return queryId;
}

function normalizeClaudeCodeSessionStatus(value: string | null): ClaudeCodeSessionStatus {
  switch (value) {
    case "active":
    case "error":
    case "idle":
    case "notLoaded":
      return value;
    default:
      throw new Error("Claude Code session/read response did not include supported status.");
  }
}

function parseClaudeCodeSessionSummary(value: unknown): ClaudeCodeSessionSummary {
  if (!isRecord(value)) {
    throw new Error("Claude Code session/list response included an invalid session.");
  }
  const sessionId = readNestedString(value, ["id"]);
  if (sessionId === null) {
    throw new Error("Claude Code session/list response included a session without id.");
  }
  const title = readNestedStringValue(value, ["title"]);
  const updatedAt = readNestedNumber(value, ["updatedAt"]);
  if (title === null || updatedAt === null) {
    throw new Error("Claude Code session/list response included a session without metadata.");
  }
  return {
    id: sessionId,
    title,
    cwd: readNestedString(value, ["cwd"]),
    createdAt: readNestedNumber(value, ["createdAt"]),
    updatedAt,
  };
}

export function parseClaudeCodeSessionListResult(
  result: unknown,
): readonly ClaudeCodeSessionSummary[] {
  if (!isRecord(result)) {
    throw new Error("Claude Code session/list response did not include sessions.");
  }
  const rawSessions = result["sessions"];
  if (!Array.isArray(rawSessions)) {
    throw new Error("Claude Code session/list response did not include sessions.");
  }
  return rawSessions.map(parseClaudeCodeSessionSummary);
}

function parseClaudeCodeSessionReadResult(result: unknown): ClaudeCodeSessionReadResult {
  const session = readNestedRecord(result, ["session"]);
  if (session === null) {
    throw new Error("Claude Code session/read response did not include session.");
  }
  const sessionId = readNestedString(result, ["session", "id"]);
  if (sessionId === null) {
    throw new Error("Claude Code session/read response did not include session.id.");
  }
  const rawQueries = session["queries"];
  if (!Array.isArray(rawQueries)) {
    throw new Error("Claude Code session/read response did not include session.queries.");
  }

  return {
    session: {
      id: sessionId,
      status: {
        type: normalizeClaudeCodeSessionStatus(
          readNestedString(result, ["session", "status", "type"]),
        ),
      },
      activeQueryId: readNestedString(result, ["session", "activeQueryId"]),
      cwd: readNestedString(result, ["session", "cwd"]),
      queries: rawQueries.map((query, index) => ({
        queryId: isRecord(query)
          ? (readNestedString(query, ["queryId"]) ?? `query_${String(index)}`)
          : `query_${String(index)}`,
        message: isRecord(query) ? query["message"] : query,
      })),
      lastError:
        typeof session["lastError"] === "string" && session["lastError"].length > 0
          ? session["lastError"]
          : null,
    },
  };
}

export function createClaudeCodeSessionClient(
  input: ClaudeCodeSessionClientInput,
): ClaudeCodeSessionClient {
  const agentStream = new AgentStreamClient({
    transport: input.transport,
  });
  const rpcClient = new ClaudeCodeJsonRpcClient(agentStream);

  return {
    close() {
      rpcClient.dispose();
      agentStream.dispose();
    },
    async connect() {
      await agentStream.connect();
      await rpcClient.initialize();
    },
    async createSession(createInput = {}) {
      const result = await rpcClient.call(
        "session/create",
        createInput.cwd === undefined || createInput.cwd === null ? {} : { cwd: createInput.cwd },
        {
          idempotency: createInput.idempotency,
        },
      );
      return {
        sessionId: extractSessionId(result, "session/create"),
      };
    },
    async interruptQuery(interruptInput) {
      await rpcClient.call("query/interrupt", {
        sessionId: interruptInput.sessionId,
      });
    },
    async listSessions(listInput = {}) {
      const result = await rpcClient.call("session/list", {
        ...(listInput.cwd === undefined || listInput.cwd === null ? {} : { cwd: listInput.cwd }),
        ...(listInput.limit === undefined ? {} : { limit: listInput.limit }),
        ...(listInput.offset === undefined ? {} : { offset: listInput.offset }),
      });
      return parseClaudeCodeSessionListResult(result);
    },
    async readSession(readInput) {
      const result = await rpcClient.call("session/read", {
        sessionId: readInput.sessionId,
      });
      return parseClaudeCodeSessionReadResult(result);
    },
    async resumeSession(resumeInput) {
      await rpcClient.call("session/resume", {
        sessionId: resumeInput.sessionId,
        ...(resumeInput.cwd === undefined || resumeInput.cwd === null
          ? {}
          : { cwd: resumeInput.cwd }),
      });
    },
    async startQuery(startInput) {
      const result = await rpcClient.call(
        "query/start",
        {
          sessionId: startInput.sessionId,
          inputText: startInput.inputText,
        },
        {
          idempotency: startInput.idempotency,
        },
      );
      return {
        queryId: extractQueryId(result, "query/start"),
      };
    },
    async steerQuery(steerInput) {
      const result = await rpcClient.call(
        "query/steer",
        {
          sessionId: steerInput.sessionId,
          inputText: steerInput.inputText,
        },
        {
          idempotency: steerInput.idempotency,
        },
      );
      return {
        queryId: extractQueryId(result, "query/steer"),
      };
    },
  };
}
