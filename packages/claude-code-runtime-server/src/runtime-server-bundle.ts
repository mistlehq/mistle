export const ClaudeCodeRuntimeServerBundle = String.raw`#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";

const listenHost = process.env.MISTLE_CLAUDE_CODE_RUNTIME_HOST ?? "127.0.0.1";
const listenPort = Number.parseInt(process.env.MISTLE_CLAUDE_CODE_RUNTIME_PORT ?? "4521", 10);
const healthPath = process.env.MISTLE_CLAUDE_CODE_RUNTIME_HEALTH_PATH ?? "/health";
const websocketPath = process.env.MISTLE_CLAUDE_CODE_RUNTIME_WS_PATH ?? "/agent";
const defaultWorkspaceRoot = "/root";

if (!Number.isInteger(listenPort) || listenPort <= 0 || listenPort > 65535) {
  throw new Error("MISTLE_CLAUDE_CODE_RUNTIME_PORT must be a valid TCP port.");
}

const conversations = new Map();

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

function createSession(input) {
  const sessionId = input.sessionId ?? randomUUID();
  const cwd = resolveClaudeCodeCwd(input.cwd);
  conversations.set(sessionId, {
    providerConversationId: sessionId,
    cwd,
    activeQueryId: null,
    queries: [],
    sdkSessionId: null,
  });
  return sessionId;
}

async function runClaudeQuery(conversation, queryId, inputText) {
  const options = createClaudeQueryOptions({
    cwd: conversation.cwd,
    session: conversation.sdkSessionId === null
      ? { kind: "new", sessionId: conversation.providerConversationId }
      : { kind: "resume", sessionId: conversation.sdkSessionId },
  });

  conversation.activeQueryId = queryId;
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
    }
  } finally {
    if (conversation.activeQueryId === queryId) {
      conversation.activeQueryId = null;
    }
    if (conversation.activeQuery !== undefined) {
      conversation.activeQuery = undefined;
    }
  }
}

function createClaudeQueryOptions(input) {
  const sessionOptions =
    input.session.kind === "new"
      ? { sessionId: input.session.sessionId }
      : { resume: input.session.sessionId };
  return {
    cwd: resolveClaudeCodeCwd(input.cwd),
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,
    ...sessionOptions,
  };
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
    if (conversation.activeQueryId === queryId) {
      conversation.activeQueryId = null;
    }
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
      const params = request.params ?? {};
      const sessionId = createSession({
        cwd: params.cwd,
      });
      return {
        session: {
          id: sessionId,
        },
      };
    }
    case "session/resume": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("session/resume requires params.sessionId.");
      }
      if (!conversations.has(params.sessionId)) {
        conversations.set(params.sessionId, {
          providerConversationId: params.sessionId,
          cwd: resolveClaudeCodeCwd(params.cwd),
          activeQueryId: null,
          queries: [],
          sdkSessionId: params.sessionId,
        });
      }
      return {};
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
      return {
        session: {
          id: conversation.providerConversationId,
          cwd: conversation.cwd,
          status: {
            type: conversation.activeQueryId === null ? "idle" : "active",
          },
          activeQueryId: conversation.activeQueryId,
          queries: conversation.queries,
          lastError: conversation.lastError ?? null,
        },
      };
    }
    case "query/start":
    case "query/steer": {
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
    }
    case "query/interrupt": {
      const params = request.params ?? {};
      if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
        throw new Error("query/interrupt requires params.sessionId.");
      }
      const conversation = requireSession(params.sessionId);
      if (
        conversation.activeQuery !== undefined &&
        typeof conversation.activeQuery.interrupt === "function"
      ) {
        await conversation.activeQuery.interrupt();
      }
      conversation.activeQueryId = null;
      return {};
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
