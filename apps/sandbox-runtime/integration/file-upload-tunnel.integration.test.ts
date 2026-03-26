import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { AsyncQueue } from "../src/tunnel/async-queue.js";
import { startTunnelClient } from "../src/tunnel/client.js";
import type { TunnelSocketMessage } from "../src/tunnel/connect-request.js";

const IntegrationTestTimeoutMs = 40_000;
const StepTimeoutMs = 5_000;

type OpenServer = {
  close: () => Promise<void>;
};

const openServers = new Set<OpenServer>();

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

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

async function nextQueueItemOrTunnelCompletion<T>(input: {
  queue: AsyncQueue<T>;
  signal: AbortSignal;
  label: string;
  tunnelCompletion: ReturnType<typeof startTunnelClient>["completion"];
}): Promise<T> {
  return await Promise.race([
    nextQueueItem(input.queue, input.signal, input.label),
    input.tunnelCompletion.then((completion) => {
      throw new Error(
        `${input.label}: tunnel client completed early with kind '${completion.kind}'${
          completion.kind === "error" ? ` (${completion.error.message})` : ""
        }`,
      );
    }),
  ]);
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
}

describe("startTunnelClient fileUpload integration", () => {
  it(
    "handles a fileUpload stream end to end and emits fileUpload.completed",
    async () => {
      const threadId = `thread_${randomUUID()}`;
      const expectedBytes = new Uint8Array([1, 2, 3, 4]);
      const expectedAttachmentDirectory = join("/tmp/attachments", threadId);

      await mkdir(expectedAttachmentDirectory, { recursive: true });
      await rm(expectedAttachmentDirectory, { force: true, recursive: true });

      const messageQueue = new AsyncQueue<TunnelSocketMessage>();
      const wsServer = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
      });
      openServers.add({
        close: async () => {
          await new Promise<void>((resolve, reject) => {
            wsServer.close((error) => {
              if (error === undefined) {
                resolve();
                return;
              }

              reject(error);
            });
          });
        },
      });

      await once(wsServer, "listening");
      const connectedSocketPromise = once(wsServer, "connection").then(([socket]) => {
        if (!(socket instanceof WebSocket)) {
          throw new Error("expected websocket connection");
        }

        socket.on("message", (payload, isBinary) => {
          if (isBinary) {
            messageQueue.push({
              kind: "binary",
              payload: toUint8Array(payload),
            });
            return;
          }

          messageQueue.push({
            kind: "text",
            payload: new TextDecoder().decode(toUint8Array(payload)),
          });
        });
        socket.on("error", (error) => {
          messageQueue.fail(error);
        });
        socket.on("close", (code, reason) => {
          messageQueue.fail(
            new Error(
              `runtime tunnel websocket closed (code=${String(code)}, reason='${reason.toString("utf8")}')`,
            ),
          );
        });

        return socket;
      });

      const signalController = new AbortController();
      const tunnelClient = startTunnelClient({
        signal: signalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      const gatewaySocket = await connectedSocketPromise;
      const stepSignal = AbortSignal.timeout(StepTimeoutMs);

      try {
        gatewaySocket.send(
          JSON.stringify({
            type: "stream.open",
            streamId: 17,
            channel: {
              kind: "fileUpload",
              threadId,
              mimeType: "image/png",
              originalFilename: "upload.png",
              sizeBytes: expectedBytes.byteLength,
            },
          }),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: messageQueue,
              signal: stepSignal,
              label: "waiting for stream.open.ok",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.open.ok",
          streamId: 17,
        });

        gatewaySocket.send(
          Buffer.from(
            encodeDataFrame({
              streamId: 17,
              payloadKind: PayloadKindRawBytes,
              payload: expectedBytes,
            }),
          ),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: messageQueue,
              signal: stepSignal,
              label: "waiting for stream.window",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.window",
          streamId: 17,
          bytes: expectedBytes.byteLength,
        });

        gatewaySocket.send(
          JSON.stringify({
            type: "stream.close",
            streamId: 17,
          }),
        );

        const completionMessage = parseTextMessage(
          await nextQueueItemOrTunnelCompletion({
            queue: messageQueue,
            signal: stepSignal,
            label: "waiting for fileUpload.completed",
            tunnelCompletion: tunnelClient.completion,
          }),
        );
        expect(completionMessage.type).toBe("stream.event");
        expect(completionMessage.streamId).toBe(17);

        const event =
          typeof completionMessage.event === "object" &&
          completionMessage.event !== null &&
          !Array.isArray(completionMessage.event)
            ? Object.fromEntries(Object.entries(completionMessage.event))
            : null;
        expect(event).not.toBeNull();
        expect(event).toMatchObject({
          type: "fileUpload.completed",
          threadId,
          originalFilename: "upload.png",
          mimeType: "image/png",
          sizeBytes: expectedBytes.byteLength,
        });

        const uploadedPath = typeof event?.path === "string" ? event.path : null;
        if (uploadedPath === null) {
          throw new Error("expected fileUpload.completed event to include a path");
        }

        expect(uploadedPath.startsWith(expectedAttachmentDirectory)).toBe(true);
        expect(Array.from(await readFile(uploadedPath))).toEqual(Array.from(expectedBytes));
      } finally {
        signalController.abort();
        await Promise.all([
          tunnelClient.close(),
          closeWebSocket(gatewaySocket),
          rm(expectedAttachmentDirectory, { force: true, recursive: true }),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
