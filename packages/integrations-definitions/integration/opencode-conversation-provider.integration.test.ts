import { once } from "node:events";

import {
  decodeDataFrame,
  encodeDataFrame,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { createOpencodeConversationProvider } from "../src/agent-runtimes/opencode/conversation-provider.server.js";

type BridgeRequest = {
  method: string;
  params: unknown;
  id: string | number;
};

type BridgeScript = (request: BridgeRequest) => Promise<unknown>;

function toText(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function toUint8Array(data: RawData): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
}

function parseStreamIdFromOpenMessage(data: RawData): number {
  const payloadText = toText(data);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    throw new Error("Expected agent connect request payload to be valid JSON.");
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("Expected agent connect request payload to be an object.");
  }

  if (
    !("type" in parsedPayload) ||
    !("streamId" in parsedPayload) ||
    !("channel" in parsedPayload)
  ) {
    throw new Error("Expected agent stream.open payload to include type/streamId/channel.");
  }

  const typeValue = parsedPayload.type;
  const streamIdValue = parsedPayload.streamId;
  const channelValue = parsedPayload.channel;

  if (typeValue !== "stream.open") {
    throw new Error(
      `Expected agent stream open type to be 'stream.open', received '${String(typeValue)}'.`,
    );
  }

  if (typeof streamIdValue !== "number" || !Number.isInteger(streamIdValue) || streamIdValue <= 0) {
    throw new Error("Expected agent stream.open streamId to be a positive integer.");
  }

  if (
    typeof channelValue !== "object" ||
    channelValue === null ||
    Array.isArray(channelValue) ||
    !("kind" in channelValue) ||
    channelValue.kind !== "agent"
  ) {
    throw new Error("Expected connect request channel.kind to be 'agent'.");
  }

  return streamIdValue;
}

function parseBridgeRequest(data: RawData): BridgeRequest {
  const dataFrame = decodeDataFrame(toUint8Array(data));
  if (dataFrame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(dataFrame.payloadKind)}.`,
    );
  }

  const parsedPayload: unknown = JSON.parse(new TextDecoder().decode(dataFrame.payload));
  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("Expected bridge JSON-RPC request object.");
  }
  if (
    !("method" in parsedPayload) ||
    typeof parsedPayload.method !== "string" ||
    !("id" in parsedPayload)
  ) {
    throw new Error("Expected bridge request to include method and id.");
  }

  return {
    method: parsedPayload.method,
    params: "params" in parsedPayload ? parsedPayload.params : undefined,
    id: parsedPayload.id as string | number,
  };
}

function readControlMessageType(data: RawData): string | null {
  const payloadText = toText(data);
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return null;
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    return null;
  }

  return "type" in parsedPayload && typeof parsedPayload.type === "string"
    ? parsedPayload.type
    : null;
}

function readBridgeErrorData(error: unknown): unknown {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return undefined;
  }

  return "data" in error ? error.data : undefined;
}

async function writeBridgeResult(
  socket: WebSocket,
  streamId: number,
  response: Record<string, unknown>,
): Promise<void> {
  const payload = encodeDataFrame({
    streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: new TextEncoder().encode(JSON.stringify(response)),
  });

  await new Promise<void>((resolve, reject) => {
    socket.send(payload, (error) => {
      if (error == null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function writeBridgeError(
  socket: WebSocket,
  streamId: number,
  input: {
    id: string | number;
    code: number;
    message: string;
    data?: unknown;
  },
): Promise<void> {
  await writeBridgeResult(socket, streamId, {
    jsonrpc: "2.0",
    id: input.id,
    error: {
      code: input.code,
      message: input.message,
      ...(input.data === undefined ? {} : { data: input.data }),
    },
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
}

async function startBridgeTestServer(script: BridgeScript): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    let activeStreamId: number | null = null;

    socket.on("message", async (message) => {
      if (activeStreamId === null) {
        activeStreamId = parseStreamIdFromOpenMessage(message);
        socket.send(
          JSON.stringify({
            type: "stream.open.ok",
            streamId: activeStreamId,
          }),
        );
        return;
      }

      let request: BridgeRequest | null = null;
      try {
        const controlMessageType = readControlMessageType(message);
        if (controlMessageType === "stream.close") {
          return;
        }

        request = parseBridgeRequest(message);
        const result = await script(request);
        await writeBridgeResult(socket, activeStreamId, {
          jsonrpc: "2.0",
          id: request.id,
          result,
        });
      } catch (error) {
        if (request === null) {
          return;
        }

        await writeBridgeError(socket, activeStreamId, {
          id: request.id,
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
          data: readBridgeErrorData(error),
        });
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    close: async () => {
      for (const client of wsServer.clients) {
        await closeWebSocket(client).catch(() => undefined);
      }
      await closeWebSocketServer(wsServer);
    },
  };
}

describe("OpenCode conversation provider", () => {
  it("creates, inspects, starts, steers, and interrupts via the bridge protocol", async () => {
    const requests: BridgeRequest[] = [];
    const server = await startBridgeTestServer(async (request) => {
      requests.push(request);

      switch (request.method) {
        case "conversation.create":
          return {
            providerConversationId: "ses_123",
          };
        case "conversation.inspect":
          if (requests.length === 2) {
            return {
              exists: true,
              status: "idle",
              activeExecutionId: null,
            };
          }
          return {
            exists: true,
            status: "active",
            activeExecutionId: "opx_123",
          };
        case "execution.start":
          return {
            providerExecutionId: "opx_123",
          };
        case "execution.steer":
          return {
            providerExecutionId: "opx_456",
          };
        case "execution.interrupt":
          return true;
        default:
          throw new Error(`unexpected method '${request.method}'`);
      }
    });

    const provider = createOpencodeConversationProvider();
    const connection = await provider.connect({
      connectionUrl: server.url,
    });

    try {
      await expect(
        provider.createConversation({
          connection,
        }),
      ).resolves.toEqual({
        providerConversationId: "ses_123",
      });

      await expect(
        provider.inspectConversation({
          connection,
          providerConversationId: "ses_123",
        }),
      ).resolves.toEqual({
        exists: true,
        status: "idle",
        activeExecutionId: null,
      });

      await expect(
        provider.startExecution({
          connection,
          providerConversationId: "ses_123",
          inputText: "Start execution",
        }),
      ).resolves.toEqual({
        providerExecutionId: "opx_123",
      });

      await expect(
        provider.steerExecution({
          connection,
          providerConversationId: "ses_123",
          providerExecutionId: "opx_123",
          inputText: "Steer execution",
        }),
      ).resolves.toEqual({
        providerExecutionId: "opx_456",
      });

      await expect(
        provider.interruptExecution({
          connection,
          providerConversationId: "ses_123",
          providerExecutionId: "opx_456",
        }),
      ).resolves.toBeUndefined();

      expect(requests.map((request) => request.method)).toEqual([
        "conversation.create",
        "conversation.inspect",
        "execution.start",
        "conversation.inspect",
        "execution.steer",
        "conversation.inspect",
        "execution.interrupt",
      ]);
    } finally {
      await connection.close();
      await server.close();
    }
  });

  it("maps missing resume conversations to provider_conversation_missing", async () => {
    const server = await startBridgeTestServer(async (request) => {
      if (request.method !== "conversation.resume") {
        throw new Error(`unexpected method '${request.method}'`);
      }

      throw Object.assign(new Error("OpenCode conversation 'ses_missing' was not found."), {
        data: {
          status: 404,
        },
      });
    });

    const provider = createOpencodeConversationProvider();
    const connection = await provider.connect({
      connectionUrl: server.url,
    });

    try {
      await expect(
        provider.resumeConversation({
          connection,
          providerConversationId: "ses_missing",
        }),
      ).rejects.toMatchObject({
        code: "provider_conversation_missing",
      });
    } finally {
      await connection.close();
      await server.close();
    }
  });

  it("maps bridge-side missing inspect errors during steer to provider_conversation_missing", async () => {
    const wsServer = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
    });

    await new Promise<void>((resolve, reject) => {
      wsServer.once("listening", () => resolve());
      wsServer.once("error", (error) => reject(error));
    });

    wsServer.on("connection", (socket) => {
      let activeStreamId: number | null = null;

      socket.on("message", async (message) => {
        if (activeStreamId === null) {
          activeStreamId = parseStreamIdFromOpenMessage(message);
          socket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId: activeStreamId,
            }),
          );
          return;
        }

        const controlMessageType = readControlMessageType(message);
        if (controlMessageType === "stream.close") {
          return;
        }

        let request: BridgeRequest;
        try {
          request = parseBridgeRequest(message);
        } catch {
          return;
        }
        await writeBridgeError(socket, activeStreamId, {
          id: request.id,
          code: -32000,
          message: "OpenCode conversation 'ses_missing' was not found.",
          data: {
            status: 404,
          },
        });
      });
    });

    const address = wsServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected websocket server to expose a concrete socket address.");
    }

    const provider = createOpencodeConversationProvider();
    const connection = await provider.connect({
      connectionUrl: `ws://127.0.0.1:${String(address.port)}`,
    });

    try {
      await expect(
        provider.steerExecution({
          connection,
          providerConversationId: "ses_missing",
          providerExecutionId: "opx_missing",
          inputText: "Steer execution",
        }),
      ).rejects.toMatchObject({
        code: "provider_conversation_missing",
        message: "OpenCode conversation 'ses_missing' was not found.",
      });
    } finally {
      await connection.close();
      await closeWebSocketServer(wsServer);
    }
  });

  it("treats idle conversations as missing active execution during steer", async () => {
    const server = await startBridgeTestServer(async (request) => {
      if (request.method !== "conversation.inspect") {
        throw new Error(`unexpected method '${request.method}'`);
      }

      return {
        exists: true,
        status: "idle",
        activeExecutionId: null,
      };
    });

    const provider = createOpencodeConversationProvider();
    const connection = await provider.connect({
      connectionUrl: server.url,
    });

    try {
      await expect(
        provider.steerExecution({
          connection,
          providerConversationId: "ses_123",
          providerExecutionId: "opx_missing",
          inputText: "Steer execution",
        }),
      ).rejects.toMatchObject({
        code: "provider_execution_missing",
        message: "OpenCode conversation 'ses_123' has no active turn to steer.",
      });
    } finally {
      await connection.close();
      await server.close();
    }
  });
});
