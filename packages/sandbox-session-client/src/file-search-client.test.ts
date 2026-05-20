import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
  type StreamControlMessage,
  type StreamDataFrame,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { FileSearchStreamClient, type FileSearchStreamSessionEvent } from "./file-search-client.js";
import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxSessionTransport } from "./transport.js";

type FileSearchTestServer = {
  close: () => Promise<void>;
  receivedControlMessages: StreamControlMessage[];
  receivedDataFrames: StreamDataFrame[];
  sendFileSearchMessage: (message: unknown) => void;
  url: string;
};

const PollIntervalMs = 10;
const openServers = new Set<FileSearchTestServer>();

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

function toText(data: RawData): string {
  return new TextDecoder().decode(toUint8Array(data));
}

async function waitForCondition(input: {
  description: string;
  evaluate: () => boolean;
  timeoutMs: number;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;
  while (Date.now() < deadlineEpochMs) {
    if (input.evaluate()) {
      return;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.description} after ${String(input.timeoutMs)}ms.`);
}

async function startFileSearchTestServer(): Promise<FileSearchTestServer> {
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  const receivedControlMessages: StreamControlMessage[] = [];
  const receivedDataFrames: StreamDataFrame[] = [];
  let clientSocket: NodeWebSocket | null = null;
  let activeStreamId: number | null = null;

  wsServer.on("connection", (socket) => {
    clientSocket = socket;

    socket.on("message", (payload, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(payload));
        if (controlMessage === undefined) {
          return;
        }

        receivedControlMessages.push(controlMessage);
        if (controlMessage.type === "stream.open") {
          activeStreamId = controlMessage.streamId;
          socket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId: controlMessage.streamId,
            }),
          );
        }
        return;
      }

      receivedDataFrames.push(decodeDataFrame(toUint8Array(payload)));
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  const server = {
    close: async (): Promise<void> => {
      clientSocket?.close();
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
    receivedControlMessages,
    receivedDataFrames,
    sendFileSearchMessage: (message: unknown): void => {
      if (clientSocket === null || activeStreamId === null) {
        throw new Error("Cannot send file search message before a stream is active.");
      }

      clientSocket.send(
        encodeDataFrame({
          streamId: activeStreamId,
          payloadKind: PayloadKindWebSocketText,
          payload: new TextEncoder().encode(JSON.stringify(message)),
        }),
      );
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
  openServers.add(server);
  return server;
}

function decodeTextFrame(frame: StreamDataFrame): string {
  expect(frame.payloadKind).toBe(PayloadKindWebSocketText);
  return new TextDecoder().decode(frame.payload);
}

function getReceivedDataFrame(server: FileSearchTestServer, index: number): StreamDataFrame {
  const frame = server.receivedDataFrames[index];
  if (frame === undefined) {
    throw new Error(`Expected received data frame at index ${String(index)}.`);
  }

  return frame;
}

function parseJsonObject(payload: string): Record<string, unknown> {
  const parsed = JSON.parse(payload);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON payload to be an object.");
  }

  return Object.fromEntries(Object.entries(parsed));
}

afterEach(async () => {
  await Promise.all([...openServers].map((server) => server.close()));
  openServers.clear();
});

describe("FileSearchStreamClient", () => {
  it("opens a file search stream and sends query frames", async () => {
    const server = await startFileSearchTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    await transport.connect({ connectionUrl: server.url });

    const session = await new FileSearchStreamClient({ transport }).openSession({
      cwd: "/workspace/project",
    });
    const requestId = await session.query({
      query: "src",
      limit: 10,
    });

    await waitForCondition({
      description: "file search query frame",
      evaluate: () => server.receivedDataFrames.length === 1,
      timeoutMs: 1_000,
    });

    expect(server.receivedControlMessages).toMatchObject([
      {
        type: "stream.open",
        channel: {
          kind: "fileSearch",
          cwd: "/workspace/project",
        },
      },
    ]);
    expect(parseJsonObject(decodeTextFrame(getReceivedDataFrame(server, 0)))).toEqual({
      type: "fileSearch.query",
      requestId,
      query: "src",
      limit: 10,
    });

    session.dispose();
    await waitForCondition({
      description: "file search stream close control message",
      evaluate: () =>
        server.receivedControlMessages.some(
          (message) => message.type === "stream.close" && message.streamId === 1,
        ),
      timeoutMs: 1_000,
    });
    transport.disconnect(1000, "Test complete.");
  });

  it("emits file search results and sends selection frames", async () => {
    const server = await startFileSearchTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    await transport.connect({ connectionUrl: server.url });

    const session = await new FileSearchStreamClient({ transport }).openSession({
      cwd: "/workspace/project",
    });
    const events: FileSearchStreamSessionEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });
    const requestId = await session.query({ query: "read" });

    server.sendFileSearchMessage({
      type: "fileSearch.results",
      requestId,
      query: "read",
      items: [
        {
          path: "README.md",
          kind: "file",
        },
      ],
    });
    await session.select({
      query: "read",
      path: "README.md",
    });

    await waitForCondition({
      description: "file search result event and select frame",
      evaluate: () => events.length === 1 && server.receivedDataFrames.length === 2,
      timeoutMs: 1_000,
    });

    expect(events).toEqual([
      {
        type: "results",
        results: {
          type: "fileSearch.results",
          requestId,
          query: "read",
          items: [
            {
              path: "README.md",
              kind: "file",
            },
          ],
        },
      },
    ]);
    expect(parseJsonObject(decodeTextFrame(getReceivedDataFrame(server, 1)))).toEqual({
      type: "fileSearch.select",
      query: "read",
      path: "README.md",
    });

    session.dispose();
    transport.disconnect(1000, "Test complete.");
  });
});
