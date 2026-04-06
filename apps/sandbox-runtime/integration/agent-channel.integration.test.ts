import { once } from "node:events";

import type { CompiledAgentRuntime } from "@mistle/integrations-core";
import {
  PayloadKindWebSocketText,
  decodeDataFrame,
  encodeDataFrame,
  parseBootstrapControlMessage,
  type BootstrapControlMessage,
} from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import type { ActiveTunnelStreamRelayResult } from "../src/tunnel/active-relay.js";
import { handleAgentConnectRequest } from "../src/tunnel/agent-channel.js";
import { AsyncQueue } from "../src/tunnel/async-queue.js";
import type { TunnelSocketMessage } from "../src/tunnel/connect-request.js";

type WebSocketPair = {
  server: WebSocketServer;
  serverSocket: WebSocket;
  clientSocket: WebSocket;
  clientMessages: AsyncQueue<TunnelSocketMessage>;
};

type CodexConnectionScript = (socket: WebSocket) => Promise<void>;

class JsonMessageQueue {
  readonly #messages: Array<Record<string, unknown>> = [];
  readonly #pendingResolvers: Array<(message: Record<string, unknown>) => void> = [];
  readonly #pendingRejectors: Array<(error: Error) => void> = [];
  #failure: Error | undefined;

  constructor(socket: WebSocket) {
    socket.on("message", (data: RawData) => {
      const parsedMessage = parseJsonMessage(rawDataToText(data));
      const resolve = this.#pendingResolvers.shift();
      const reject = this.#pendingRejectors.shift();
      if (resolve === undefined || reject === undefined) {
        this.#messages.push(parsedMessage);
        return;
      }

      resolve(parsedMessage);
    });
    socket.once("error", (error: Error) => {
      this.#fail(error);
    });
    socket.once("close", () => {
      this.#fail(new Error("websocket closed while awaiting a JSON message"));
    });
  }

  next(): Promise<Record<string, unknown>> {
    const nextMessage = this.#messages.shift();
    if (nextMessage !== undefined) {
      return Promise.resolve(nextMessage);
    }
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure);
    }

    return awaitJsonMessage(this.#pendingResolvers, this.#pendingRejectors);
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) {
      return;
    }

    this.#failure = error;
    while (this.#pendingRejectors.length > 0) {
      const reject = this.#pendingRejectors.shift();
      this.#pendingResolvers.shift();
      reject?.(error);
    }
  }
}

function createRuntimeClient() {
  return {
    clientId: "client_openai",
    setup: {
      env: {},
      files: [],
    },
    processes: [],
    endpoints: [
      {
        endpointKey: "app-server",
        transport: {
          type: "ws" as const,
          url: "ws://127.0.0.1:4501",
        },
        connectionMode: "dedicated" as const,
      },
    ],
  };
}

function createAgentRuntime(): CompiledAgentRuntime {
  return {
    bindingId: "binding_openai",
    runtimeId: "codex",
    runtimeKey: "codex-app-server",
    clientId: "client_openai",
    endpointKey: "app-server",
    ptyLaunch: {
      runtimeId: "codex",
      displayName: "Codex",
      newLaunch: {
        ptySessionId: "cli",
        cols: 120,
        rows: 32,
        command: "codex",
        args: [],
      },
      resumeLaunch: {
        ptySessionId: "cli",
        cols: 120,
        rows: 32,
        command: "codex",
        args: [
          {
            kind: "literal",
            value: "resume",
          },
          {
            kind: "threadId",
          },
        ],
      },
    },
  };
}

function readListeningPort(server: WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("websocket server address must be available");
  }

  return address.port;
}

function rawDataToUint8Array(payload: RawData): Uint8Array {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (Array.isArray(payload)) {
    return Uint8Array.from(Buffer.concat(payload));
  }

  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function rawDataToText(payload: RawData): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(payload));
  }
  if (Array.isArray(payload)) {
    return Buffer.concat(payload).toString("utf8");
  }

  return payload.toString("utf8");
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
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

async function nextQueueItem<T>(
  queue: AsyncQueue<T>,
  signal: AbortSignal,
  label: string,
): Promise<T> {
  try {
    return await queue.next(signal);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createTunnelWebSocketPair(): Promise<WebSocketPair> {
  const server = new WebSocketServer({
    port: 0,
  });
  await once(server, "listening");

  const clientMessages = new AsyncQueue<TunnelSocketMessage>();
  const connectionPromise = once(server, "connection").then(([socket]) => {
    if (!(socket instanceof WebSocket)) {
      throw new Error("server websocket connection is required");
    }

    return socket;
  });

  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(readListeningPort(server))}`);
  clientSocket.on("message", (payload, isBinary) => {
    if (isBinary) {
      clientMessages.push({
        kind: "binary",
        payload: rawDataToUint8Array(payload),
      });
      return;
    }

    clientMessages.push({
      kind: "text",
      payload: rawDataToText(payload),
    });
  });
  clientSocket.on("error", (error) => {
    clientMessages.fail(error);
  });
  clientSocket.on("close", () => {
    clientMessages.fail(new Error("tunnel client websocket closed"));
  });

  await once(clientSocket, "open");
  const serverSocket = await connectionPromise;

  return {
    server,
    serverSocket,
    clientSocket,
    clientMessages,
  };
}

async function createCodexServer(scripts: readonly CodexConnectionScript[]): Promise<{
  server: WebSocketServer;
  url: string;
}> {
  const server = new WebSocketServer({
    port: 0,
  });
  await once(server, "listening");

  let connectionIndex = 0;
  server.on("connection", (socket) => {
    const script = scripts[connectionIndex];
    connectionIndex += 1;
    if (script === undefined) {
      socket.close();
      return;
    }

    void script(socket).finally(() => {
      void closeWebSocket(socket).catch(() => undefined);
    });
  });

  return {
    server,
    url: `ws://127.0.0.1:${String(readListeningPort(server))}`,
  };
}

function awaitJsonMessage(
  resolvers: Array<(message: Record<string, unknown>) => void>,
  rejectors: Array<(error: Error) => void>,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    resolvers.push(resolve);
    rejectors.push(reject);
  });
}

function parseJsonMessage(payload: string): Record<string, unknown> {
  const parsedPayload: unknown = JSON.parse(payload);
  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("expected websocket JSON object");
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

async function writeJsonMessage(socket: WebSocket, payload: object): Promise<void> {
  const message = JSON.stringify(payload);
  await new Promise<void>((resolve, reject) => {
    socket.send(message, (error?: Error | null) => {
      if (error == null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function nextBootstrapControlMessage(
  queue: AsyncQueue<TunnelSocketMessage>,
  signal: AbortSignal,
): Promise<BootstrapControlMessage> {
  while (true) {
    const message = await nextQueueItem(queue, signal, "failed waiting for tunnel message");
    if (message.kind === "binary") {
      continue;
    }

    const parsedMessage = parseBootstrapControlMessage(message.payload);
    if (parsedMessage === undefined) {
      continue;
    }

    return parsedMessage;
  }
}

async function nextBinaryTunnelMessage(
  queue: AsyncQueue<TunnelSocketMessage>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  while (true) {
    const message = await nextQueueItem(queue, signal, "failed waiting for tunnel message");
    if (message.kind !== "binary") {
      continue;
    }

    return message.payload;
  }
}

describe("handleAgentConnectRequest", () => {
  it("forwards localImage turn input to the agent endpoint unchanged", async () => {
    const signal = new AbortController();
    const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
    const { server, serverSocket, clientSocket, clientMessages } =
      await createTunnelWebSocketPair();
    const codexServer = await createCodexServer([
      async (socket) => {
        const messages = new JsonMessageQueue(socket);
        // This integration test stops at the sandbox-runtime boundary. It proves the
        // agent channel preserves localImage input when forwarding turn/start payloads.
        const request = await messages.next();
        expect(request).toMatchObject({
          id: "request_local_image",
          method: "turn/start",
          params: {
            threadId: "thr_local_image",
            input: [
              {
                type: "text",
                text: "Describe this image",
              },
              {
                type: "localImage",
                path: "/tmp/attachments/thr_local_image/uploaded-image.png",
              },
            ],
          },
        });

        await writeJsonMessage(socket, {
          id: request.id,
          result: {
            turn: {
              id: "turn_local_image",
              status: "inProgress",
            },
          },
        });
      },
    ]);

    try {
      const runtimeClient = createRuntimeClient();
      runtimeClient.endpoints = [
        {
          endpointKey: "app-server",
          transport: {
            type: "ws",
            url: codexServer.url,
          },
          connectionMode: "dedicated",
        },
      ];

      const relay = await handleAgentConnectRequest({
        signal: signal.signal,
        tunnelSocket: serverSocket,
        streamId: 1,
        agentRuntimes: [createAgentRuntime()],
        runtimeClients: [runtimeClient],
        relayResultQueue,
      });

      expect(relay).toBeDefined();
      if (relay === undefined) {
        throw new Error("agent relay is required");
      }

      await expect(nextBootstrapControlMessage(clientMessages, signal.signal)).resolves.toEqual({
        type: "stream.open.ok",
        streamId: 1,
      });

      relay.messages.push({
        kind: "binary",
        payload: encodeDataFrame({
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: new TextEncoder().encode(
            JSON.stringify({
              id: "request_local_image",
              method: "turn/start",
              params: {
                threadId: "thr_local_image",
                input: [
                  {
                    type: "text",
                    text: "Describe this image",
                  },
                  {
                    type: "localImage",
                    path: "/tmp/attachments/thr_local_image/uploaded-image.png",
                  },
                ],
              },
            }),
          ),
        }),
      });

      const responseFrame = decodeDataFrame(
        await nextBinaryTunnelMessage(clientMessages, signal.signal),
      );
      expect(responseFrame.streamId).toBe(1);
      expect(new TextDecoder().decode(responseFrame.payload)).toContain("turn_local_image");
    } finally {
      signal.abort();
      await closeWebSocket(clientSocket).catch(() => undefined);
      await closeWebSocket(serverSocket).catch(() => undefined);
      await closeWebSocketServer(server).catch(() => undefined);
      await closeWebSocketServer(codexServer.server).catch(() => undefined);
    }
  });
});
