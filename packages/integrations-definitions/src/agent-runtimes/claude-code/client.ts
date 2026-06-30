import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { AgentStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";
import {
  ClaudeCodeRuntimeMethods,
  extractClaudeCodeQueryId,
  extractClaudeCodeSessionId,
  isClaudeCodeRecord,
  readClaudeCodeNestedString,
} from "./protocol.js";

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
  availableCommands: readonly ClaudeCodeCommandSummary[];
  availableModels: readonly ClaudeCodeModelSummary[];
  model: string | null;
  modelReasoningEffort: string | null;
};

export type ClaudeCodeContextUsage = {
  contextWindow: number;
  percent: number | null;
  tokens: number | null;
};

export type ClaudeCodeCommandSummary = {
  description: string | null;
  name: string;
};

export type ClaudeCodeSessionReadResult = {
  session: {
    activeQueryId: string | null;
    config: ClaudeCodeSessionConfig;
    contextUsage: ClaudeCodeContextUsage | null;
    cwd: string | null;
    id: string;
    lastError: string | null;
    pendingPermissions: readonly ClaudeCodePermissionRequest[];
    queries: readonly ClaudeCodeSessionQuery[];
    status: {
      type: ClaudeCodeSessionStatus;
    };
  };
};

export type ClaudeCodePermissionRequest = {
  id: string;
  sessionId: string;
  toolInput: unknown;
  toolName: string;
};

export type ClaudeCodePermissionResponseInput = {
  answers?: readonly {
    id: string;
    value: string;
  }[];
  decision?: "always" | "once" | "reject";
  message?: string;
  requestId: string;
  sessionId: string;
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
  respondToPermission(input: ClaudeCodePermissionResponseInput): Promise<void>;
  refreshCommandCatalog(input: {
    refresh?: boolean;
    sessionId: string;
  }): Promise<ClaudeCodeSessionConfig>;
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

function readNestedRecord(value: unknown, path: readonly string[]): Record<string, unknown> | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isClaudeCodeRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return isClaudeCodeRecord(currentValue) ? currentValue : null;
}

function readNestedStringValue(value: unknown, path: readonly string[]): string | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isClaudeCodeRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return typeof currentValue === "string" ? currentValue : null;
}

function readNestedNumber(value: unknown, path: readonly string[]): number | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isClaudeCodeRecord(currentValue)) {
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
  if (!isClaudeCodeRecord(value)) {
    throw new Error("Claude Code session/list response included an invalid session.");
  }
  const sessionId = readClaudeCodeNestedString(value, ["id"]);
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
    cwd: readClaudeCodeNestedString(value, ["cwd"]),
    createdAt: readNestedNumber(value, ["createdAt"]),
    updatedAt,
  };
}

function parseClaudeCodeReasoningEffortOption(value: unknown): ClaudeCodeReasoningEffortOption {
  if (!isClaudeCodeRecord(value)) {
    throw new Error("Claude Code session config response included an invalid reasoning option.");
  }
  const optionValue = readClaudeCodeNestedString(value, ["value"]);
  const label = readClaudeCodeNestedString(value, ["label"]);
  if (optionValue === null || label === null) {
    throw new Error("Claude Code session config response included an incomplete reasoning option.");
  }
  return {
    value: optionValue,
    label,
  };
}

function parseClaudeCodeModelSummary(value: unknown): ClaudeCodeModelSummary {
  if (!isClaudeCodeRecord(value)) {
    throw new Error("Claude Code session config response included an invalid model.");
  }
  const model = readClaudeCodeNestedString(value, ["model"]);
  const displayName = readClaudeCodeNestedString(value, ["displayName"]);
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
    defaultReasoningEffort: readClaudeCodeNestedString(value, ["defaultReasoningEffort"]),
    reasoningEffortOptions: reasoningEffortOptions.map(parseClaudeCodeReasoningEffortOption),
    inputModalities: parseStringArray(value["inputModalities"], "inputModalities"),
    isDefault: value["isDefault"] === true,
  };
}

function parseClaudeCodeCommandSummary(value: unknown): ClaudeCodeCommandSummary {
  if (!isClaudeCodeRecord(value)) {
    throw new Error("Claude Code session config response included an invalid command.");
  }
  const name = readClaudeCodeNestedString(value, ["name"]);
  if (name === null) {
    throw new Error("Claude Code session config response included a command without name.");
  }
  return {
    name,
    description: readNestedStringValue(value, ["description"]),
  };
}

function parseClaudeCodeSessionConfig(value: unknown): ClaudeCodeSessionConfig {
  if (!isClaudeCodeRecord(value)) {
    throw new Error("Claude Code session/read response did not include session config.");
  }
  const rawAvailableCommands = value["availableCommands"];
  if (!Array.isArray(rawAvailableCommands)) {
    throw new Error("Claude Code session config did not include availableCommands.");
  }
  const rawAvailableModels = value["availableModels"];
  if (!Array.isArray(rawAvailableModels)) {
    throw new Error("Claude Code session config did not include availableModels.");
  }
  return {
    availableCommands: rawAvailableCommands.map(parseClaudeCodeCommandSummary),
    availableModels: rawAvailableModels.map(parseClaudeCodeModelSummary),
    model: readClaudeCodeNestedString(value, ["model"]),
    modelReasoningEffort: readClaudeCodeNestedString(value, ["modelReasoningEffort"]),
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

function parseClaudeCodePermissionRequest(value: unknown): ClaudeCodePermissionRequest {
  if (!isClaudeCodeRecord(value)) {
    throw new Error("Claude Code session/read response included an invalid permission request.");
  }
  const id = readClaudeCodeNestedString(value, ["id"]);
  const sessionId = readClaudeCodeNestedString(value, ["sessionId"]);
  const toolName = readClaudeCodeNestedString(value, ["toolName"]);
  if (id === null || sessionId === null || toolName === null) {
    throw new Error("Claude Code permission request response did not include required metadata.");
  }
  return {
    id,
    sessionId,
    toolName,
    toolInput: value["toolInput"],
  };
}

function parseClaudeCodeContextUsage(value: unknown): ClaudeCodeContextUsage | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isClaudeCodeRecord(value)) {
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
  if (!isClaudeCodeRecord(result)) {
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
  const sessionId = readClaudeCodeNestedString(result, ["session", "id"]);
  if (sessionId === null) {
    throw new Error("Claude Code session/read response did not include session.id.");
  }
  const rawQueries = session["queries"];
  if (!Array.isArray(rawQueries)) {
    throw new Error("Claude Code session/read response did not include session.queries.");
  }
  const rawPendingPermissions = session["pendingPermissions"];
  if (!Array.isArray(rawPendingPermissions)) {
    throw new Error(
      "Claude Code session/read response did not include session.pendingPermissions.",
    );
  }

  return {
    session: {
      id: sessionId,
      status: {
        type: normalizeClaudeCodeSessionStatus(
          readClaudeCodeNestedString(result, ["session", "status", "type"]),
        ),
      },
      activeQueryId: readClaudeCodeNestedString(result, ["session", "activeQueryId"]),
      config: parseClaudeCodeSessionConfig(session["config"]),
      contextUsage: parseClaudeCodeContextUsage(session["contextUsage"]),
      cwd: readClaudeCodeNestedString(result, ["session", "cwd"]),
      pendingPermissions: rawPendingPermissions.map(parseClaudeCodePermissionRequest),
      queries: rawQueries.map((query, index) => ({
        queryId: isClaudeCodeRecord(query)
          ? (readClaudeCodeNestedString(query, ["queryId"]) ?? `query_${String(index)}`)
          : `query_${String(index)}`,
        message: isClaudeCodeRecord(query) ? query["message"] : query,
      })),
      lastError:
        typeof session["lastError"] === "string" && session["lastError"].length > 0
          ? session["lastError"]
          : null,
    },
  };
}

export function buildClaudeCodeSessionSteerQueryParams(input: {
  inputText: string;
  sessionId: string;
}): Record<string, unknown> {
  return {
    sessionId: input.sessionId,
    inputText: input.inputText,
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
        ClaudeCodeRuntimeMethods.SESSION_CREATE,
        createInput.cwd === undefined || createInput.cwd === null ? {} : { cwd: createInput.cwd },
        {
          idempotency: createInput.idempotency,
        },
      );
      return {
        sessionId: extractClaudeCodeSessionId(result, ClaudeCodeRuntimeMethods.SESSION_CREATE),
      };
    },
    async interruptQuery(interruptInput) {
      await rpcClient.call(ClaudeCodeRuntimeMethods.QUERY_INTERRUPT, {
        queryId: interruptInput.queryId,
        sessionId: interruptInput.sessionId,
      });
    },
    async listSessions(listInput = {}) {
      const result = await rpcClient.call(ClaudeCodeRuntimeMethods.SESSION_LIST, {
        ...(listInput.cwd === undefined || listInput.cwd === null ? {} : { cwd: listInput.cwd }),
        ...(listInput.limit === undefined ? {} : { limit: listInput.limit }),
        ...(listInput.offset === undefined ? {} : { offset: listInput.offset }),
      });
      return parseClaudeCodeSessionListResult(result);
    },
    async readSession(readInput) {
      const result = await rpcClient.call(ClaudeCodeRuntimeMethods.SESSION_READ, {
        sessionId: readInput.sessionId,
      });
      return parseClaudeCodeSessionReadResult(result);
    },
    async respondToPermission(permissionInput) {
      await rpcClient.call(ClaudeCodeRuntimeMethods.PERMISSION_REPLY, {
        sessionId: permissionInput.sessionId,
        requestId: permissionInput.requestId,
        ...(permissionInput.decision === undefined ? {} : { decision: permissionInput.decision }),
        ...(permissionInput.answers === undefined ? {} : { answers: permissionInput.answers }),
        ...(permissionInput.message === undefined ? {} : { message: permissionInput.message }),
      });
    },
    async refreshCommandCatalog(refreshInput) {
      const result = await rpcClient.call(ClaudeCodeRuntimeMethods.SESSION_COMMAND_CATALOG, {
        sessionId: refreshInput.sessionId,
        ...(refreshInput.refresh === undefined ? {} : { refresh: refreshInput.refresh }),
      });
      return parseClaudeCodeSessionConfigRpcResult(
        result,
        ClaudeCodeRuntimeMethods.SESSION_COMMAND_CATALOG,
      );
    },
    async refreshModelCatalog(refreshInput) {
      const result = await rpcClient.call(ClaudeCodeRuntimeMethods.SESSION_MODEL_CATALOG, {
        sessionId: refreshInput.sessionId,
        ...(refreshInput.refresh === undefined ? {} : { refresh: refreshInput.refresh }),
      });
      return parseClaudeCodeSessionConfigRpcResult(
        result,
        ClaudeCodeRuntimeMethods.SESSION_MODEL_CATALOG,
      );
    },
    async resumeSession(resumeInput) {
      await rpcClient.call(ClaudeCodeRuntimeMethods.SESSION_RESUME, {
        sessionId: resumeInput.sessionId,
        ...(resumeInput.cwd === undefined || resumeInput.cwd === null
          ? {}
          : { cwd: resumeInput.cwd }),
      });
    },
    async setSessionConfig(configInput) {
      const result = await rpcClient.call(ClaudeCodeRuntimeMethods.SESSION_CONFIGURE, {
        sessionId: configInput.sessionId,
        model: configInput.model,
        modelReasoningEffort: configInput.modelReasoningEffort,
      });
      return parseClaudeCodeSessionConfigRpcResult(
        result,
        ClaudeCodeRuntimeMethods.SESSION_CONFIGURE,
      );
    },
    async startQuery(startInput) {
      const result = await rpcClient.call(
        ClaudeCodeRuntimeMethods.QUERY_START,
        {
          sessionId: startInput.sessionId,
          inputText: startInput.inputText,
        },
        {
          idempotency: startInput.idempotency,
        },
      );
      return {
        queryId: extractClaudeCodeQueryId(result, ClaudeCodeRuntimeMethods.QUERY_START),
      };
    },
    async steerQuery(steerInput) {
      const result = await rpcClient.call(
        ClaudeCodeRuntimeMethods.QUERY_STEER,
        buildClaudeCodeSessionSteerQueryParams({
          sessionId: steerInput.sessionId,
          inputText: steerInput.inputText,
        }),
        {
          idempotency: steerInput.idempotency,
        },
      );
      return {
        queryId: extractClaudeCodeQueryId(result, ClaudeCodeRuntimeMethods.QUERY_STEER),
      };
    },
  };
}
