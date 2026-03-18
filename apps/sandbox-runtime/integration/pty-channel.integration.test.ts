import { once } from "node:events";

import {
  PayloadKindRawBytes,
  decodeDataFrame,
  encodeDataFrame,
} from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import type { ActiveTunnelStreamRelayResult } from "../src/tunnel/active-relay.js";
import { AsyncQueue } from "../src/tunnel/async-queue.js";
import type { TunnelSocketMessage } from "../src/tunnel/connect-request.js";
import { handlePtyConnectRequest } from "../src/tunnel/pty-channel.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

type WebSocketPair = {
  server: WebSocketServer;
  serverSocket: WebSocket;
  clientSocket: WebSocket;
  clientMessages: AsyncQueue<TunnelSocketMessage>;
};

function createPtyStreamOpenPayload(streamId: number): string {
  return JSON.stringify({
    type: "stream.open",
    streamId,
    channel: {
      kind: "pty",
      session: "create",
      cols: 80,
      rows: 24,
    },
  });
}

function readListeningPort(server: WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("websocket server address must be available");
  }

  return address.port;
}

function parseTextMessage(message: TunnelSocketMessage): Record<string, unknown> {
  if (message.kind !== "text") {
    throw new Error("expected websocket text message");
  }

  const parsed = JSON.parse(message.payload);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected websocket JSON object message");
  }

  return Object.fromEntries(Object.entries(parsed));
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

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = new WebSocketServer({
    port: 0,
  });

  await once(server, "listening");

  const clientMessages = new AsyncQueue<TunnelSocketMessage>();
  const connectionPromise = once(server, "connection").then(([socket]) => {
    if (!(socket instanceof WebSocket)) {
      throw new Error("server connection socket is required");
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

    const textPayload =
      typeof payload === "string"
        ? payload
        : new TextDecoder().decode(rawDataToUint8Array(payload));
    clientMessages.push({
      kind: "text",
      payload: textPayload,
    });
  });
  clientSocket.on("error", (error) => {
    clientMessages.fail(error);
  });
  clientSocket.on("close", () => {
    clientMessages.fail(new Error("client websocket closed"));
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

describe("handlePtyConnectRequest", () => {
  it("emits the PTY exit event only after the final output is sent", async () => {
    const signal = new AbortController();
    const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
    const marker = "__MISTLE_PTY_EXIT_ORDER__";
    const { server, serverSocket, clientSocket, clientMessages } = await createWebSocketPair();

    try {
      const { relay } = await handlePtyConnectRequest({
        signal: signal.signal,
        tunnelSocket: serverSocket,
        rawPayload: createPtyStreamOpenPayload(1),
        streamId: 1,
        activePtySession: undefined,
        relayResultQueue,
      });

      expect(relay).toBeDefined();
      if (relay === undefined) {
        throw new Error("pty relay is required");
      }

      const openOk = parseTextMessage(
        await nextQueueItem(clientMessages, signal.signal, "failed waiting for stream.open.ok"),
      );
      expect(openOk).toEqual({
        type: "stream.open.ok",
        streamId: 1,
      });

      relay.messages.push({
        kind: "binary",
        payload: encodeDataFrame({
          streamId: 1,
          payloadKind: PayloadKindRawBytes,
          payload: textEncoder.encode(`printf '${marker}\\n'; exit 7\n`),
        }),
      });

      const binaryOutputChunks: string[] = [];
      let exitCode: number | undefined;

      while (exitCode === undefined) {
        const nextMessage = await nextQueueItem(
          clientMessages,
          signal.signal,
          "failed waiting for PTY relay output",
        );
        if (nextMessage.kind === "binary") {
          const dataFrame = decodeDataFrame(nextMessage.payload);
          if (dataFrame.streamId !== 1) {
            throw new Error(
              `expected PTY output for stream 1, received ${String(dataFrame.streamId)}`,
            );
          }
          binaryOutputChunks.push(textDecoder.decode(dataFrame.payload, { stream: true }));
          continue;
        }

        const textMessage = parseTextMessage(nextMessage);
        const messageType = typeof textMessage.type === "string" ? textMessage.type : "";
        if (messageType === "stream.window") {
          if (textMessage.streamId !== 1) {
            throw new Error(
              `expected stream.window for stream 1, received ${String(textMessage.streamId)}`,
            );
          }
          continue;
        }

        if (messageType === "stream.event") {
          const event =
            typeof textMessage.event === "object" &&
            textMessage.event !== null &&
            !Array.isArray(textMessage.event)
              ? Object.fromEntries(Object.entries(textMessage.event))
              : undefined;
          if (
            event === undefined ||
            event.type !== "pty.exit" ||
            typeof event.exitCode !== "number"
          ) {
            throw new Error("expected pty exit event message");
          }

          exitCode = event.exitCode;
          continue;
        }
      }

      expect(exitCode).toBe(7);
      expect(binaryOutputChunks.join("")).toContain(marker);

      const relayResult = await nextQueueItem(
        relayResultQueue,
        signal.signal,
        "failed waiting for PTY relay completion",
      );
      expect(relayResult.error).toBeUndefined();
      expect(relayResult.updatesPtySession).toBe(true);
      if (!relayResult.updatesPtySession) {
        throw new Error("expected PTY relay result to update the PTY session");
      }
      expect(relayResult.ptySession).toBeUndefined();
    } finally {
      signal.abort();
      await closeWebSocket(clientSocket).catch(() => undefined);
      await closeWebSocket(serverSocket).catch(() => undefined);
      await closeWebSocketServer(server).catch(() => undefined);
    }
  });
});
