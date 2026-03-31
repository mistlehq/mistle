import { OpencodeBridgeJsonRpcErrorCodes, OpencodeBridgeMethodNames } from "./bridge-protocol.js";
import { OpencodeBridgeListenUrl, OpencodeServerBaseUrl } from "./server.js";

function escapeForTemplateLiteral(input: string): string {
  return input.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}

export function renderOpencodeBridgeScript(input?: {
  listenUrl?: string;
  opencodeBaseUrl?: string;
}): string {
  const listenUrl = input?.listenUrl ?? OpencodeBridgeListenUrl;
  const opencodeBaseUrl = input?.opencodeBaseUrl ?? OpencodeServerBaseUrl;

  return `
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const listenUrl = new URL(${JSON.stringify(escapeForTemplateLiteral(listenUrl))});
const opencodeBaseUrl = new URL(${JSON.stringify(escapeForTemplateLiteral(opencodeBaseUrl))});
const jsonRpcErrorCodes = ${JSON.stringify(OpencodeBridgeJsonRpcErrorCodes)};
const methodNames = ${JSON.stringify(OpencodeBridgeMethodNames)};
const executionStateByConversationId = new Map();

function createJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequestId(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) {
    return undefined;
  }
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  const text = await response.text();
  return text.length === 0 ? undefined : text;
}

async function requestOpencode(pathname, init) {
  const response = await fetch(new URL(pathname, opencodeBaseUrl), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw createJsonRpcError(
      jsonRpcErrorCodes.UPSTREAM_REQUEST_FAILED,
      \`Opencode request failed with status \${String(response.status)} for \${pathname}\`,
      {
        status: response.status,
        pathname,
        body,
      },
    );
  }

  return body;
}

async function readConversationStatus(providerConversationId) {
  const session = await requestOpencode(\`/session/\${providerConversationId}\`, {
    method: "GET",
  }).catch((error) => {
    if (isRecord(error) && error.code === jsonRpcErrorCodes.UPSTREAM_REQUEST_FAILED) {
      const errorData = isRecord(error.data) ? error.data : undefined;
      if (errorData?.status === 404) {
        return null;
      }
    }
    throw error;
  });

  if (session === null) {
    executionStateByConversationId.delete(providerConversationId);
    return {
      exists: false,
      status: "idle",
      activeExecutionId: null,
    };
  }

  const statusMap = await requestOpencode("/session/status", {
    method: "GET",
  });
  const statusInfo =
    isRecord(statusMap) && isRecord(statusMap[providerConversationId])
      ? statusMap[providerConversationId]
      : { type: "idle" };

  if (statusInfo.type === "busy" || statusInfo.type === "retry") {
    return {
      exists: true,
      status: "active",
      activeExecutionId: executionStateByConversationId.get(providerConversationId) ?? null,
    };
  }

  executionStateByConversationId.delete(providerConversationId);
  return {
    exists: true,
    status: "idle",
    activeExecutionId: null,
  };
}

async function handleBridgeMethod(method, params) {
  switch (method) {
    case methodNames.CONVERSATION_CREATE: {
      const options = isRecord(params) && isRecord(params.options) ? params.options : {};
      const session = await requestOpencode("/session", {
        method: "POST",
        body: JSON.stringify(options),
      });
      if (!isRecord(session) || typeof session.id !== "string" || session.id.length === 0) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.INTERNAL_ERROR,
          "Opencode conversation.create response did not include session.id.",
        );
      }
      return {
        providerConversationId: session.id,
        providerState: session,
      };
    }
    case methodNames.CONVERSATION_INSPECT: {
      if (
        !isRecord(params) ||
        typeof params.providerConversationId !== "string" ||
        params.providerConversationId.trim().length === 0
      ) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.INVALID_PARAMS,
          "conversation.inspect requires providerConversationId.",
        );
      }
      return await readConversationStatus(params.providerConversationId);
    }
    case methodNames.CONVERSATION_RESUME: {
      if (
        !isRecord(params) ||
        typeof params.providerConversationId !== "string" ||
        params.providerConversationId.trim().length === 0
      ) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.INVALID_PARAMS,
          "conversation.resume requires providerConversationId.",
        );
      }
      const inspect = await readConversationStatus(params.providerConversationId);
      if (!inspect.exists) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.UPSTREAM_REQUEST_FAILED,
          \`Opencode conversation '\${params.providerConversationId}' was not found.\`,
          {
            status: 404,
            pathname: \`/session/\${params.providerConversationId}\`,
          },
        );
      }
      return true;
    }
    case methodNames.EXECUTION_START:
    case methodNames.EXECUTION_STEER: {
      if (
        !isRecord(params) ||
        typeof params.providerConversationId !== "string" ||
        params.providerConversationId.trim().length === 0
      ) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.INVALID_PARAMS,
          \`\${method} requires providerConversationId.\`,
        );
      }
      if (typeof params.inputText !== "string" || params.inputText.trim().length === 0) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.INVALID_PARAMS,
          \`\${method} requires non-empty inputText.\`,
        );
      }
      const executionId = \`opx_\${randomUUID().replaceAll("-", "")}\`;
      await requestOpencode(\`/session/\${params.providerConversationId}/prompt_async\`, {
        method: "POST",
        body: JSON.stringify({
          parts: [
            {
              type: "text",
              text: params.inputText,
            },
          ],
        }),
      });
      executionStateByConversationId.set(params.providerConversationId, executionId);
      return {
        providerExecutionId: executionId,
      };
    }
    case methodNames.EXECUTION_INTERRUPT: {
      if (
        !isRecord(params) ||
        typeof params.providerConversationId !== "string" ||
        params.providerConversationId.trim().length === 0
      ) {
        throw createJsonRpcError(
          jsonRpcErrorCodes.INVALID_PARAMS,
          "execution.interrupt requires providerConversationId.",
        );
      }
      await requestOpencode(\`/session/\${params.providerConversationId}/abort\`, {
        method: "POST",
      });
      return true;
    }
    default:
      throw createJsonRpcError(
        jsonRpcErrorCodes.METHOD_NOT_FOUND,
        \`Method '\${String(method)}' is not supported.\`,
      );
  }
}

async function handleMessage(socket, payload) {
  let envelope;
  try {
    envelope = JSON.parse(payload);
  } catch {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: createJsonRpcError(
          jsonRpcErrorCodes.PARSE_ERROR,
          "Request payload must be valid JSON.",
        ),
      }),
    );
    return;
  }

  if (!isRecord(envelope) || envelope.jsonrpc !== "2.0" || typeof envelope.method !== "string") {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: readRequestId(envelope?.id),
        error: createJsonRpcError(
          jsonRpcErrorCodes.INVALID_REQUEST,
          "Request must be a JSON-RPC 2.0 object.",
        ),
      }),
    );
    return;
  }

  const requestId = readRequestId(envelope.id);
  if (requestId === null) {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: createJsonRpcError(
          jsonRpcErrorCodes.INVALID_REQUEST,
          "Request id must be a non-empty string or finite number.",
        ),
      }),
    );
    return;
  }

  try {
    const result = await handleBridgeMethod(envelope.method, envelope.params);
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result,
      }),
    );
  } catch (error) {
    const jsonRpcError =
      isRecord(error) && typeof error.code === "number" && typeof error.message === "string"
        ? error
        : createJsonRpcError(
            jsonRpcErrorCodes.INTERNAL_ERROR,
            error instanceof Error ? error.message : String(error),
          );

    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        error: jsonRpcError,
      }),
    );
  }
}

const server = createServer();
const webSocketServer = new WebSocketServer({
  server,
});

webSocketServer.on("connection", (socket) => {
  socket.on("message", async (payload, isBinary) => {
    if (isBinary) {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: createJsonRpcError(
            jsonRpcErrorCodes.INVALID_REQUEST,
            "Binary websocket messages are not supported.",
          ),
        }),
      );
      return;
    }

    await handleMessage(
      socket,
      typeof payload === "string" ? payload : payload.toString("utf8"),
    );
  });
});

server.listen(Number.parseInt(listenUrl.port, 10), listenUrl.hostname);
`;
}
