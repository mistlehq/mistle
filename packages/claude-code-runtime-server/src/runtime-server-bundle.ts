export const ClaudeCodeRuntimeServerBundle = String.raw`#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { getSessionMessages, listSessions, query } from "@anthropic-ai/claude-agent-sdk";

const listenHost = process.env.MISTLE_CLAUDE_CODE_RUNTIME_HOST ?? "127.0.0.1";
const listenPort = Number.parseInt(process.env.MISTLE_CLAUDE_CODE_RUNTIME_PORT ?? "4521", 10);
const healthPath = process.env.MISTLE_CLAUDE_CODE_RUNTIME_HEALTH_PATH ?? "/health";
const websocketPath = process.env.MISTLE_CLAUDE_CODE_RUNTIME_WS_PATH ?? "/agent";
const defaultWorkspaceRoot = "/root";

if (!Number.isInteger(listenPort) || listenPort <= 0 || listenPort > 65535) {
  throw new Error("MISTLE_CLAUDE_CODE_RUNTIME_PORT must be a valid TCP port.");
}

const conversations = new Map();
const idempotentResults = new Map();
const ClaudeCodeReasoningEffortLabels = new Map([
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
]);

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function sendResult(socket, id, result) {
  sendJson(socket, { id, result });
}

function sendError(socket, id, code, message, data) {
  sendJson(socket, {
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function requireSession(sessionId) {
  const conversation = conversations.get(sessionId);
  if (conversation === undefined) {
    throw new Error("Claude Code session not found: " + sessionId);
  }
  return conversation;
}

function resolveClaudeCodeCwd(cwd) {
  if (cwd === undefined || cwd === null) {
    return defaultWorkspaceRoot;
  }
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new Error("Claude Code cwd must be a non-empty string.");
  }
  return cwd;
}

function resolveClaudeCodeLookupCwd(cwd) {
  if (cwd === undefined || cwd === null || cwd === "") {
    return null;
  }
  return resolveClaudeCodeCwd(cwd);
}

function createSession(input) {
  const sessionId = randomUUID();
  const cwd = resolveClaudeCodeCwd(input.cwd);
  conversations.set(sessionId, createConversationState({
    providerConversationId: sessionId,
    cwd,
    sdkLookupCwd: cwd,
    sdkSessionId: null,
  }));
  return sessionId;
}

function createConversationState(input) {
  return {
    providerConversationId: input.providerConversationId,
    cwd: input.cwd,
    activeQueryId: null,
    queries: [],
    sdkSessionId: input.sdkSessionId,
    sdkLookupCwd: input.sdkLookupCwd,
    activeQueryAbortController: undefined,
    selectedModel: null,
    selectedReasoningEffort: null,
    modelCatalog: null,
    modelCatalogLoadPromise: null,
    contextUsage: null,
  };
}

function resolveClaudeCodeModelInput(model) {
  if (model === undefined || model === null || model === "") {
    return null;
  }
  if (typeof model !== "string") {
    throw new Error("Claude Code model must be a string.");
  }
  return model;
}

function resolveClaudeCodeReasoningEffort(effort) {
  if (effort === undefined || effort === null || effort === "") {
    return null;
  }
  if (typeof effort !== "string") {
    throw new Error("Claude Code reasoning effort must be a string.");
  }
  if (!ClaudeCodeReasoningEffortLabels.has(effort)) {
    throw new Error("Unsupported Claude Code reasoning effort: " + effort);
  }
  return effort;
}

async function configureSession(conversation, input) {
  const selectedModel = resolveClaudeCodeModelInput(input.model);
  const selectedReasoningEffort = resolveClaudeCodeReasoningEffort(input.modelReasoningEffort);

  if (selectedModel === null && selectedReasoningEffort !== null) {
    throw new Error("Choose a Claude Code model before setting reasoning effort.");
  }

  const modelCatalog = selectedModel === null ? [] : await loadConversationModelCatalog(conversation, false);
  const model =
    selectedModel === null
      ? null
      : modelCatalog.find((candidate) => candidate.model === selectedModel) ?? null;
  if (selectedModel !== null && model === null) {
    throw new Error("Unsupported Claude Code model: " + selectedModel);
  }

  if (
    model !== null &&
    selectedReasoningEffort !== null &&
    !model.reasoningEffortOptions.some((option) => option.value === selectedReasoningEffort)
  ) {
    throw new Error(
      "Claude Code model " +
        selectedModel +
        " does not support reasoning effort " +
        selectedReasoningEffort +
        ".",
    );
  }
  conversation.selectedModel = selectedModel;
  conversation.selectedReasoningEffort = selectedReasoningEffort;
  conversation.contextUsage = null;
}

function buildConversationConfig(conversation) {
  return {
    availableModels: conversation.modelCatalog ?? [],
    model: conversation.selectedModel,
    modelReasoningEffort: conversation.selectedReasoningEffort,
  };
}

function createIdlePromptStream() {
  return {
    async next() {
      return new Promise(() => {});
    },
    async return() {
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function mapClaudeCodeReasoningEffortOption(value) {
  return {
    value,
    label: ClaudeCodeReasoningEffortLabels.get(value),
  };
}

function mapClaudeCodeModelInfo(modelInfo) {
  if (
    modelInfo === null ||
    typeof modelInfo !== "object" ||
    typeof modelInfo.value !== "string" ||
    modelInfo.value.length === 0 ||
    typeof modelInfo.displayName !== "string" ||
    modelInfo.displayName.length === 0
  ) {
    throw new Error("Claude Code returned an invalid model catalog entry.");
  }
  const supportedEffortLevels = Array.isArray(modelInfo.supportedEffortLevels)
    ? modelInfo.supportedEffortLevels.filter((value) => ClaudeCodeReasoningEffortLabels.has(value))
    : [];
  return {
    model: modelInfo.value,
    displayName: modelInfo.value === "default" ? "Default" : modelInfo.displayName,
    defaultReasoningEffort: null,
    reasoningEffortOptions: supportedEffortLevels.map(mapClaudeCodeReasoningEffortOption),
    inputModalities: ["text", "image"],
    isDefault: modelInfo.value === "default",
  };
}

async function fetchClaudeCodeModelCatalog(conversation) {
  const sdkQuery = query({
    prompt: createIdlePromptStream(),
    options: createClaudeQueryOptions({
      cwd: conversation.cwd,
      session: { kind: "new", sessionId: randomUUID() },
    }),
  });
  try {
    const models = await sdkQuery.supportedModels();
    return models.map(mapClaudeCodeModelInfo);
  } finally {
    await sdkQuery.close();
  }
}

async function loadConversationModelCatalog(conversation, refresh) {
  if (!refresh && conversation.modelCatalog !== null) {
    return conversation.modelCatalog;
  }
  if (!refresh && conversation.modelCatalogLoadPromise !== null) {
    return conversation.modelCatalogLoadPromise;
  }
  const loadPromise = fetchClaudeCodeModelCatalog(conversation);
  conversation.modelCatalogLoadPromise = loadPromise;
  try {
    const modelCatalog = await loadPromise;
    conversation.modelCatalog = modelCatalog;
    return modelCatalog;
  } finally {
    if (conversation.modelCatalogLoadPromise === loadPromise) {
      conversation.modelCatalogLoadPromise = null;
    }
  }
}

function idempotencyKeyForRequest(request) {
  const idempotency = request.idempotency;
  if (idempotency === undefined || idempotency === null) {
    return null;
  }
  const key =
    typeof idempotency === "string"
      ? idempotency
      : typeof idempotency === "object" && typeof idempotency.key === "string"
        ? idempotency.key
        : null;
  if (key === null || key.length === 0) {
    throw new Error("Claude Code idempotency key must be a non-empty string.");
  }
  const fingerprint =
    typeof idempotency === "object" && typeof idempotency.requestFingerprint === "string"
      ? idempotency.requestFingerprint
      : JSON.stringify(request.params ?? null);
  return request.method + ":" + key + ":" + fingerprint;
}

async function handleIdempotentRequest(request, operation) {
  const key = idempotencyKeyForRequest(request);
  if (key !== null && idempotentResults.has(key)) {
    return idempotentResults.get(key);
  }
  const result = await operation();
  if (key !== null) {
    idempotentResults.set(key, result);
  }
  return result;
}

async function listSessionPage(input) {
  const cwd = input.cwd === undefined || input.cwd === null
    ? undefined
    : resolveClaudeCodeCwd(input.cwd);
  const sessions = await listSessions({
    ...(cwd === undefined ? {} : { dir: cwd }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  });
  return sessions.map((session) => ({
    id: session.sessionId,
    title: session.summary,
    cwd: session.cwd ?? cwd ?? null,
    createdAt: session.createdAt ?? null,
    updatedAt: session.lastModified,
  }));
}

async function runClaudeQuery(conversation, queryId, inputText) {
  const abortController = new AbortController();
  const options = createClaudeQueryOptions({
    cwd: conversation.cwd,
    session: conversation.sdkSessionId === null
      ? { kind: "new", sessionId: conversation.providerConversationId }
      : { kind: "resume", sessionId: conversation.sdkSessionId },
    abortController,
    model: conversation.selectedModel,
    reasoningEffort: conversation.selectedReasoningEffort,
  });

  conversation.activeQueryId = queryId;
  conversation.activeQueryAbortController = abortController;
  try {
    const sdkQuery = query({
      prompt: inputText,
      options,
    });
    conversation.activeQuery = sdkQuery;
    for await (const message of sdkQuery) {
      if (
        message !== null &&
        typeof message === "object" &&
        "session_id" in message &&
        typeof message.session_id === "string"
      ) {
        conversation.sdkSessionId = message.session_id;
      }
      conversation.queries.push({
        queryId,
        message,
      });
      if (
        message !== null &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "result"
      ) {
        updateContextUsageFromResultMessage(conversation, message);
      }
    }
  } finally {
    if (conversation.activeQueryId === queryId) {
      conversation.activeQueryId = null;
    }
    if (conversation.activeQuery !== undefined) {
      conversation.activeQuery = undefined;
    }
    if (conversation.activeQueryAbortController === abortController) {
      conversation.activeQueryAbortController = undefined;
    }
  }
}

function createClaudeQueryOptions(input) {
  const sessionOptions =
    input.session.kind === "new"
      ? { sessionId: input.session.sessionId }
      : { resume: input.session.sessionId };
  return {
    ...(input.cwd === undefined || input.cwd === null
      ? {}
      : { cwd: resolveClaudeCodeCwd(input.cwd) }),
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,
    ...(input.abortController === undefined ? {} : { abortController: input.abortController }),
    ...(input.model === undefined || input.model === null ? {} : { model: input.model }),
    ...(input.reasoningEffort === undefined || input.reasoningEffort === null
      ? {}
      : { effort: input.reasoningEffort }),
    ...sessionOptions,
  };
}

function updateContextUsageFromResultMessage(conversation, message) {
  if (
    !("modelUsage" in message) ||
    message.modelUsage === null ||
    typeof message.modelUsage !== "object"
  ) {
    return;
  }
  let latestUsage = null;
  for (const modelUsage of Object.values(message.modelUsage)) {
    if (modelUsage === null || typeof modelUsage !== "object") {
      continue;
    }
    const contextWindow =
      typeof modelUsage.contextWindow === "number" ? modelUsage.contextWindow : null;
    if (contextWindow === null || contextWindow <= 0) {
      continue;
    }
    const totalTokens =
      readNumber(modelUsage, "inputTokens") +
      readNumber(modelUsage, "outputTokens") +
      readNumber(modelUsage, "cacheReadInputTokens") +
      readNumber(modelUsage, "cacheCreationInputTokens");
    latestUsage = {
      tokens: totalTokens,
      contextWindow,
      percent: Math.round((totalTokens / contextWindow) * 100),
    };
  }
  conversation.contextUsage = latestUsage;
}

function readNumber(value, key) {
  return typeof value[key] === "number" ? value[key] : 0;
}

function collectAssistantText(message) {
  if (
    message === null ||
    typeof message !== "object" ||
    !("type" in message) ||
    message.type !== "assistant" ||
    !("message" in message) ||
    message.message === null ||
    typeof message.message !== "object" ||
    !("content" in message.message) ||
    !Array.isArray(message.message.content)
  ) {
    return "";
  }

  const textParts = [];
  for (const content of message.message.content) {
    if (
      content !== null &&
      typeof content === "object" &&
      "type" in content &&
      content.type === "text" &&
      "text" in content &&
      typeof content.text === "string"
    ) {
      textParts.push(content.text);
    }
  }
  return textParts.join(" ");
}

function collectUserText(message) {
  if (typeof message === "string") {
    return message;
  }
  if (
    message === null ||
    typeof message !== "object" ||
    !("content" in message)
  ) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }

  const textParts = [];
  for (const content of message.content) {
    if (
      content !== null &&
      typeof content === "object" &&
      "type" in content &&
      content.type === "text" &&
      "text" in content &&
      typeof content.text === "string"
    ) {
      textParts.push(content.text);
    }
  }
  return textParts.join("\n\n");
}

async function readConversationQueries(conversation) {
  if (conversation.queries.length > 0 || conversation.sdkSessionId === null) {
    return conversation.queries;
  }

  const messages = await getSessionMessages(conversation.sdkSessionId, {
    ...(conversation.sdkLookupCwd === null ? {} : { dir: conversation.sdkLookupCwd }),
  });
  const queries = messages.flatMap((message) => {
    if (message.type === "user") {
      return [
        {
          queryId: message.uuid,
          message: {
            type: "user",
            text: collectUserText(message.message),
          },
        },
      ];
    }
    if (message.type === "assistant") {
      return [
        {
          queryId: message.uuid,
          message: {
            type: "assistant",
            message: message.message,
          },
        },
      ];
    }
    return [];
  });
  conversation.queries = queries;
  return queries;
}

function normalizeGeneratedTitle(text) {
  const firstLine = text
    .replace(/^["']+|["']+$/g, "")
    .split(/\r?\n/u)[0]
    ?.trim();
  if (firstLine === undefined || firstLine.length === 0) {
    throw new Error("Claude Code title generation returned empty text.");
  }
  return firstLine.length <= 80 ? firstLine : firstLine.slice(0, 77).trimEnd() + "...";
}

async function generateTitle(inputText) {
  const prompt =
    "Generate a concise conversation title, five words or fewer. Return only the title.\n\n" +
    inputText;
  const sdkQuery = query({
    prompt,
    options: createClaudeQueryOptions({
      session: { kind: "new", sessionId: randomUUID() },
    }),
  });
  let titleText = "";
  for await (const message of sdkQuery) {
    titleText += collectAssistantText(message);
  }
  return normalizeGeneratedTitle(titleText);
}

function appendSubmittedUserQuery(conversation, queryId, inputText) {
  conversation.queries.push({
    queryId,
    message: {
      type: "user",
      text: inputText,
    },
  });
}

function startQuery(conversation, inputText) {
  const queryId = randomUUID();
  appendSubmittedUserQuery(conversation, queryId, inputText);
  void runClaudeQuery(conversation, queryId, inputText).catch((error) => {
    conversation.lastError = error instanceof Error ? error.message : String(error);
  });
  return queryId;
}

async function handleRequest(request) {
  switch (request.method) {
    case "initialize":
      return {
        userAgent: "mistle-claude-code-runtime-server",
      };
    case "session/create": {
      return handleIdempotentRequest(request, () => {
        const params = request.params ?? {};
        const sessionId = createSession({
          cwd: params.cwd,
        });
        return {
          session: {
            id: sessionId,
          },
        };
      });
    }
    case "session/list": {
      const params = request.params ?? {};
      return {
        sessions: await listSessionPage({
          cwd: params.cwd,
          limit: params.limit,
          offset: params.offset,
        }),
      };
    }
    case "session/resume": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("session/resume requires params.sessionId.");
      }
      if (!conversations.has(params.sessionId)) {
        const lookupCwd = resolveClaudeCodeLookupCwd(params.cwd);
        conversations.set(params.sessionId, createConversationState({
          providerConversationId: params.sessionId,
          cwd: lookupCwd,
          sdkSessionId: params.sessionId,
          sdkLookupCwd: lookupCwd,
        }));
      }
      return {};
    }
    case "session/configure": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("session/configure requires params.sessionId.");
      }
      const conversation = requireSession(params.sessionId);
      if (conversation.activeQueryId !== null) {
        throw new Error("Claude Code model settings cannot be changed while a query is active.");
      }
      await configureSession(conversation, {
        model: params.model,
        modelReasoningEffort: params.modelReasoningEffort,
      });
      return {
        config: buildConversationConfig(conversation),
      };
    }
    case "session/model-catalog": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("session/model-catalog requires params.sessionId.");
      }
      const conversation = requireSession(params.sessionId);
      await loadConversationModelCatalog(conversation, params.refresh === true);
      return {
        config: buildConversationConfig(conversation),
      };
    }
    case "title/generate": {
      const params = request.params ?? {};
      if (typeof params.inputText !== "string") {
        throw new Error("title/generate requires params.inputText.");
      }
      return {
        title: await generateTitle(params.inputText),
      };
    }
    case "session/read": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("session/read requires params.sessionId.");
      }
      const conversation = requireSession(params.sessionId);
      const queries = await readConversationQueries(conversation);
      return {
        session: {
          id: conversation.providerConversationId,
          cwd: conversation.cwd,
          status: {
            type: conversation.activeQueryId === null ? "idle" : "active",
          },
          activeQueryId: conversation.activeQueryId,
          queries,
          lastError: conversation.lastError ?? null,
          config: buildConversationConfig(conversation),
          contextUsage: conversation.contextUsage,
        },
      };
    }
    case "query/start":
    case "query/steer": {
      return handleIdempotentRequest(request, () => {
        const params = request.params ?? {};
        if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
          throw new Error(request.method + " requires params.sessionId.");
        }
        if (typeof params.inputText !== "string") {
          throw new Error(request.method + " requires params.inputText.");
        }
        const conversation = requireSession(params.sessionId);
        const queryId = startQuery(conversation, params.inputText);
        return {
          query: {
            id: queryId,
            status: "running",
          },
          queryId,
        };
      });
    }
    case "query/interrupt": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("query/interrupt requires params.sessionId.");
      }
      if (typeof params.queryId !== "string" || params.queryId.length === 0) {
        throw new Error("query/interrupt requires params.queryId.");
      }
      const conversation = requireSession(params.sessionId);
      if (conversation.activeQueryId !== params.queryId) {
        return {
          interrupted: false,
          reason: "stale_query",
        };
      }
      if (conversation.activeQueryAbortController !== undefined) {
        conversation.activeQueryAbortController.abort();
      }
      if (
        conversation.activeQuery !== undefined &&
        typeof conversation.activeQuery.close === "function"
      ) {
        await conversation.activeQuery.close();
      }
      return {
        interrupted: true,
      };
    }
    default:
      throw new Error("Unsupported Claude Code runtime method: " + request.method);
  }
}

const server = http.createServer((request, response) => {
  if (request.url === healthPath) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

const webSocketServer = new WebSocketServer({
  server,
  path: websocketPath,
});

webSocketServer.on("connection", (socket) => {
  socket.on("message", (data) => {
    void (async () => {
      let request;
      try {
        request = JSON.parse(data.toString());
      } catch (error) {
        sendError(socket, null, -32700, "Invalid JSON-RPC payload.");
        return;
      }
      if (
        request === null ||
        typeof request !== "object" ||
        typeof request.method !== "string"
      ) {
        sendError(socket, null, -32600, "Invalid JSON-RPC request.");
        return;
      }
      if (!("id" in request)) {
        return;
      }
      try {
        const result = await handleRequest(request);
        sendResult(socket, request.id, result);
      } catch (error) {
        sendError(
          socket,
          request.id,
          -32603,
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  });
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    "Claude Code runtime server listening on " +
      listenHost +
      ":" +
      String(listenPort) +
      websocketPath +
      "\n",
  );
});
`;
