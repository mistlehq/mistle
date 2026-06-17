import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { AgentStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";

export type ClaudeCodeSessionStatus = "active" | "error" | "idle" | "notLoaded";

export type ClaudeCodeSessionQuery = {
  queryId: string;
  message: unknown;
};

export type ClaudeCodeReasoningEffortOption = {
  label: string;
  value: string;
};

export type ClaudeCodeModelSummary = {
  defaultReasoningEffort: string | null;
  displayName: string;
  inputModalities: readonly string[];
  isDefault: boolean;
  model: string;
  reasoningEffortOptions: readonly ClaudeCodeReasoningEffortOption[];
};

export type ClaudeCodeSessionConfig = {
  availableModels: readonly ClaudeCodeModelSummary[];
  model: string | null;
  modelReasoningEffort: string | null;
};

export type ClaudeCodeContextUsage = {
  contextWindow: number;
  percent: number | null;
  tokens: number | null;
};

export type ClaudeCodeSessionReadResult = {
  session: {
    activeQueryId: string | null;
    config: ClaudeCodeSessionConfig;
    contextUsage: ClaudeCodeContextUsage | null;
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
  interruptQuery(input: { queryId: string; sessionId: string }): Promise<void>;
  listSessions(input?: {
    cwd?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<readonly ClaudeCodeSessionSummary[]>;
  readSession(input: { sessionId: string }): Promise<ClaudeCodeSessionReadResult>;
  refreshModelCatalog(input: {
    refresh?: boolean;
    sessionId: string;
  }): Promise<ClaudeCodeSessionConfig>;
  resumeSession(input: { cwd?: string | null; sessionId: string }): Promise<void>;
  setSessionConfig(input: {
    model: string | null;
    modelReasoningEffort: string | null;
    sessionId: string;
  }): Promise<ClaudeCodeSessionConfig>;
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

function parseStringArray(value: unknown, fieldName: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Claude Code session config response included invalid ${fieldName}.`);
  }
  return value;
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

function parseClaudeCodeReasoningEffortOption(value: unknown): ClaudeCodeReasoningEffortOption {
  if (!isRecord(value)) {
    throw new Error("Claude Code session config response included an invalid reasoning option.");
  }
  const optionValue = readNestedString(value, ["value"]);
  const label = readNestedString(value, ["label"]);
  if (optionValue === null || label === null) {
    throw new Error("Claude Code session config response included an incomplete reasoning option.");
  }
  return {
    value: optionValue,
    label,
  };
}

function parseClaudeCodeModelSummary(value: unknown): ClaudeCodeModelSummary {
  if (!isRecord(value)) {
    throw new Error("Claude Code session config response included an invalid model.");
  }
  const model = readNestedString(value, ["model"]);
  const displayName = readNestedString(value, ["displayName"]);
  if (model === null || displayName === null) {
    throw new Error("Claude Code session config response included a model without metadata.");
  }
  const reasoningEffortOptions = value["reasoningEffortOptions"];
  if (!Array.isArray(reasoningEffortOptions)) {
    throw new Error("Claude Code session config response included invalid reasoningEffortOptions.");
  }
  return {
    model,
    displayName,
    defaultReasoningEffort: readNestedString(value, ["defaultReasoningEffort"]),
    reasoningEffortOptions: reasoningEffortOptions.map(parseClaudeCodeReasoningEffortOption),
    inputModalities: parseStringArray(value["inputModalities"], "inputModalities"),
    isDefault: value["isDefault"] === true,
  };
}

function parseClaudeCodeSessionConfig(value: unknown): ClaudeCodeSessionConfig {
  if (!isRecord(value)) {
    throw new Error("Claude Code session/read response did not include session config.");
  }
  const rawAvailableModels = value["availableModels"];
  if (!Array.isArray(rawAvailableModels)) {
    throw new Error("Claude Code session config did not include availableModels.");
  }
  return {
    availableModels: rawAvailableModels.map(parseClaudeCodeModelSummary),
    model: readNestedString(value, ["model"]),
    modelReasoningEffort: readNestedString(value, ["modelReasoningEffort"]),
  };
}

function parseClaudeCodeSessionConfigRpcResult(
  result: unknown,
  method: string,
): ClaudeCodeSessionConfig {
  const config = readNestedRecord(result, ["config"]);
  if (config === null) {
    throw new Error(`Claude Code ${method} response did not include config.`);
  }
  return parseClaudeCodeSessionConfig(config);
}

function parseClaudeCodeContextUsage(value: unknown): ClaudeCodeContextUsage | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Claude Code session/read response included invalid contextUsage.");
  }
  const contextWindow = readNestedNumber(value, ["contextWindow"]);
  if (contextWindow === null) {
    throw new Error("Claude Code contextUsage did not include contextWindow.");
  }
  return {
    contextWindow,
    tokens: readNestedNumber(value, ["tokens"]),
    percent: readNestedNumber(value, ["percent"]),
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

export function parseClaudeCodeSessionReadResult(result: unknown): ClaudeCodeSessionReadResult {
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
      config: parseClaudeCodeSessionConfig(session["config"]),
      contextUsage: parseClaudeCodeContextUsage(session["contextUsage"]),
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
        queryId: interruptInput.queryId,
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
    async refreshModelCatalog(refreshInput) {
      const result = await rpcClient.call("session/model-catalog", {
        sessionId: refreshInput.sessionId,
        ...(refreshInput.refresh === undefined ? {} : { refresh: refreshInput.refresh }),
      });
      return parseClaudeCodeSessionConfigRpcResult(result, "session/model-catalog");
    },
    async resumeSession(resumeInput) {
      await rpcClient.call("session/resume", {
        sessionId: resumeInput.sessionId,
        ...(resumeInput.cwd === undefined || resumeInput.cwd === null
          ? {}
          : { cwd: resumeInput.cwd }),
      });
    },
    async setSessionConfig(configInput) {
      const result = await rpcClient.call("session/configure", {
        sessionId: configInput.sessionId,
        model: configInput.model,
        modelReasoningEffort: configInput.modelReasoningEffort,
      });
      return parseClaudeCodeSessionConfigRpcResult(result, "session/configure");
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
