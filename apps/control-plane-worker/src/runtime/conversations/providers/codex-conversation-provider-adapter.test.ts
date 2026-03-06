import { describe, expect, it } from "vitest";
import type { RawData } from "ws";
import { WebSocketServer } from "ws";

import { ConversationProviderErrorCodes } from "../provider-errors.js";
import { createCodexConversationProviderAdapter } from "./codex-conversation-provider-adapter.js";

type JsonRpcErrorResponse = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcHandlerOutput = {
  result?: unknown;
  error?: JsonRpcErrorResponse;
};

type JsonRpcRequest = {
  id: string | number;
  method: string;
  params: unknown;
};

type CodexRpcTestServer = {
  requests: JsonRpcRequest[];
  url: string;
  close: () => Promise<void>;
};

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonPayload(data: RawData): Record<string, unknown> {
  const textPayload = toText(data);
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(textPayload);
  } catch {
    throw new Error(`Expected JSON payload. Received: ${textPayload}`);
  }
  if (!isRecord(parsedPayload)) {
    throw new Error("Expected parsed websocket payload to be a JSON object.");
  }

  return parsedPayload;
}

async function startCodexRpcTestServer(
  handler: (request: JsonRpcRequest) => JsonRpcHandlerOutput,
): Promise<CodexRpcTestServer> {
  const requests: JsonRpcRequest[] = [];
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    let connected = false;

    socket.on("message", (data) => {
      const parsedPayload = parseJsonPayload(data);
      if (!connected) {
        const requestId = parsedPayload.requestId;
        if (typeof requestId !== "string" || requestId.length === 0) {
          throw new Error("Expected non-empty connect.requestId.");
        }
        connected = true;
        socket.send(
          JSON.stringify({
            type: "connect.ok",
            requestId,
          }),
        );
        return;
      }

      const idValue = parsedPayload.id;
      const methodValue = parsedPayload.method;
      if (
        (typeof idValue !== "string" && typeof idValue !== "number") ||
        typeof methodValue !== "string"
      ) {
        throw new Error("Expected JSON-RPC payload with id and method.");
      }
      const paramsValue = "params" in parsedPayload ? parsedPayload.params : undefined;

      const request: JsonRpcRequest = {
        id: idValue,
        method: methodValue,
        params: paramsValue,
      };
      requests.push(request);

      const response = handler(request);
      if (response.error !== undefined) {
        socket.send(
          JSON.stringify({
            id: request.id,
            error: response.error,
          }),
        );
        return;
      }

      socket.send(
        JSON.stringify({
          id: request.id,
          result: response.result ?? null,
        }),
      );
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server address to be available.");
  }

  return {
    requests,
    url: `ws://127.0.0.1:${String(address.port)}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

describe("codex conversation provider adapter", () => {
  it("sends codex JSON-RPC methods for create/resume/start/steer and maps outputs", async () => {
    const server = await startCodexRpcTestServer((request) => {
      switch (request.method) {
        case "thread/start":
          return {
            result: {
              thread: {
                id: "thread_001",
              },
            },
          };
        case "thread/resume":
          return {
            result: {
              resumed: true,
            },
          };
        case "turn/start":
          return {
            result: {
              turn: {
                id: "turn_001",
              },
            },
          };
        case "turn/steer":
          return {
            result: {
              turn: {
                id: "turn_002",
              },
            },
          };
        case "thread/read":
          return {
            result: {
              thread: {
                id: "thread_001",
                status: "Active",
                activeTurnId: "turn_001",
              },
            },
          };
        default:
          throw new Error(`Unexpected method '${request.method}'.`);
      }
    });

    const adapter = createCodexConversationProviderAdapter();
    const connection = await adapter.connect({
      connectionUrl: server.url,
    });

    try {
      const createdConversation = await adapter.createConversation({
        connection,
        options: {
          model: "gpt-5.3-codex",
        },
      });
      expect(createdConversation.providerConversationId).toBe("thread_001");

      await adapter.resumeConversation({
        connection,
        providerConversationId: "thread_001",
      });

      const startedExecution = await adapter.startExecution({
        connection,
        providerConversationId: "thread_001",
        inputText: "hello",
      });
      expect(startedExecution.providerExecutionId).toBe("turn_001");

      const steeredExecution = await adapter.steerExecution?.({
        connection,
        providerConversationId: "thread_001",
        providerExecutionId: "turn_001",
        inputText: "continue",
      });
      expect(steeredExecution?.providerExecutionId).toBe("turn_002");

      const inspectedConversation = await adapter.inspectConversation({
        connection,
        providerConversationId: "thread_001",
      });
      expect(inspectedConversation).toEqual({
        exists: true,
        status: "active",
        activeExecutionId: "turn_001",
      });
    } finally {
      await connection.close();
      await server.close();
    }

    expect(server.requests.map((request) => request.method)).toEqual([
      "thread/start",
      "thread/resume",
      "turn/start",
      "turn/steer",
      "thread/read",
    ]);
    expect(server.requests[0]?.params).toEqual({
      model: "gpt-5.3-codex",
    });
    expect(server.requests[1]?.params).toEqual({
      threadId: "thread_001",
    });
    expect(server.requests[2]?.params).toEqual({
      threadId: "thread_001",
      input: [
        {
          type: "text",
          text: "hello",
        },
      ],
    });
    expect(server.requests[3]?.params).toEqual({
      threadId: "thread_001",
      input: [
        {
          type: "text",
          text: "continue",
        },
      ],
      expectedTurnId: "turn_001",
    });
    expect(server.requests[4]?.params).toEqual({
      threadId: "thread_001",
    });
  });

  it("maps thread/read not found errors to exists=false", async () => {
    const server = await startCodexRpcTestServer((request) => {
      if (request.method !== "thread/read") {
        throw new Error(`Unexpected method '${request.method}'.`);
      }

      return {
        error: {
          code: -32_000,
          message: "thread not found",
        },
      };
    });

    const adapter = createCodexConversationProviderAdapter();
    const connection = await adapter.connect({
      connectionUrl: server.url,
    });

    try {
      await expect(
        adapter.inspectConversation({
          connection,
          providerConversationId: "thread_missing",
        }),
      ).resolves.toEqual({
        exists: false,
        status: "idle",
        activeExecutionId: null,
      });
    } finally {
      await connection.close();
      await server.close();
    }
  });

  it("maps codex thread status variants into normalized inspect states", async () => {
    const statusFixtures = [
      {
        statusPayload: "Idle",
        expectedStatus: "idle",
      },
      {
        statusPayload: {
          type: "NotLoaded",
        },
        expectedStatus: "idle",
      },
      {
        statusPayload: {
          status: "SystemError",
        },
        expectedStatus: "error",
      },
    ] as const;

    for (const fixture of statusFixtures) {
      const server = await startCodexRpcTestServer((request) => {
        if (request.method !== "thread/read") {
          throw new Error(`Unexpected method '${request.method}'.`);
        }

        return {
          result: {
            thread: {
              id: "thread_status_fixture",
              status: fixture.statusPayload,
            },
          },
        };
      });

      const adapter = createCodexConversationProviderAdapter();
      const connection = await adapter.connect({
        connectionUrl: server.url,
      });

      try {
        const inspectOutput = await adapter.inspectConversation({
          connection,
          providerConversationId: "thread_status_fixture",
        });
        expect(inspectOutput.exists).toBe(true);
        expect(inspectOutput.status).toBe(fixture.expectedStatus);
      } finally {
        await connection.close();
        await server.close();
      }
    }
  });

  it("fails createConversation when thread id is missing from response", async () => {
    const server = await startCodexRpcTestServer((request) => {
      if (request.method !== "thread/start") {
        throw new Error(`Unexpected method '${request.method}'.`);
      }

      return {
        result: {
          thread: {},
        },
      };
    });

    const adapter = createCodexConversationProviderAdapter();
    const connection = await adapter.connect({
      connectionUrl: server.url,
    });

    try {
      await expect(
        adapter.createConversation({
          connection,
          options: {
            model: "gpt-5.3-codex",
          },
        }),
      ).rejects.toMatchObject({
        code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      });
    } finally {
      await connection.close();
      await server.close();
    }
  });
});
