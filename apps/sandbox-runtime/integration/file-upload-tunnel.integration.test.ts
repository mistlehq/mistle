import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { encodeDataFrame, PayloadKindRawBytes } from "@mistle/sandbox-session-protocol";
import { systemScheduler } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { AsyncQueue } from "../src/tunnel/async-queue.js";
import { startTunnelClient } from "../src/tunnel/client.js";
import type { TunnelSocketMessage } from "../src/tunnel/connect-request.js";
import { ImageSignatures } from "../src/tunnel/validate-uploaded-image.js";

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

type ConnectedGatewaySocket = {
  messageQueue: AsyncQueue<TunnelSocketMessage>;
  socket: WebSocket;
};

function attachSocketMessageQueue(socket: WebSocket): AsyncQueue<TunnelSocketMessage> {
  const messageQueue = new AsyncQueue<TunnelSocketMessage>();
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

  return messageQueue;
}

async function waitForGatewayConnection(server: WebSocketServer): Promise<ConnectedGatewaySocket> {
  const [socket] = await once(server, "connection");
  if (!(socket instanceof WebSocket)) {
    throw new Error("expected websocket connection");
  }

  return {
    socket,
    messageQueue: attachSocketMessageQueue(socket),
  };
}

async function listAttachmentDirectoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    systemScheduler.schedule(resolve, delayMs);
  });
}

async function waitForAttachmentDirectoryEntries(input: {
  path: string;
  expectedEntries: string[];
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const entries = await listAttachmentDirectoryEntries(input.path);
    if (
      entries.length === input.expectedEntries.length &&
      entries.every((entry, index) => entry === input.expectedEntries[index])
    ) {
      return;
    }

    await sleep(25);
  }

  throw new Error(
    `attachment directory did not reach expected entries ${JSON.stringify(input.expectedEntries)} within ${String(input.timeoutMs)}ms`,
  );
}

describe("startTunnelClient fileUpload integration", () => {
  it(
    "handles a fileUpload stream end to end and emits fileUpload.completed",
    async () => {
      const threadId = `thread_${randomUUID()}`;
      const expectedBytes = ImageSignatures.PNG;
      const expectedAttachmentDirectory = join("/tmp/attachments", threadId);

      await mkdir(expectedAttachmentDirectory, { recursive: true });
      await rm(expectedAttachmentDirectory, { force: true, recursive: true });

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
      const signalController = new AbortController();
      const tunnelClient = startTunnelClient({
        signal: signalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      const gatewayConnection = await waitForGatewayConnection(wsServer);
      const gatewaySocket = gatewayConnection.socket;
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
              queue: gatewayConnection.messageQueue,
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
              queue: gatewayConnection.messageQueue,
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
            queue: gatewayConnection.messageQueue,
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

  it(
    "does not emit completion and leaves no files when the tunnel websocket closes after open but before upload bytes",
    async () => {
      const threadId = `thread_${randomUUID()}`;
      const expectedAttachmentDirectory = join("/tmp/attachments", threadId);

      await mkdir(expectedAttachmentDirectory, { recursive: true });
      await rm(expectedAttachmentDirectory, { force: true, recursive: true });

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

      const signalController = new AbortController();
      const tunnelClient = startTunnelClient({
        signal: signalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      const gatewayConnection = await waitForGatewayConnection(wsServer);
      const stepSignal = AbortSignal.timeout(StepTimeoutMs);

      try {
        gatewayConnection.socket.send(
          JSON.stringify({
            type: "stream.open",
            streamId: 31,
            channel: {
              kind: "fileUpload",
              threadId,
              mimeType: "image/png",
              originalFilename: "no-bytes.png",
              sizeBytes: ImageSignatures.PNG.byteLength,
            },
          }),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: gatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for stream.open.ok",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.open.ok",
          streamId: 31,
        });

        await closeWebSocket(gatewayConnection.socket);
        await waitForAttachmentDirectoryEntries({
          path: expectedAttachmentDirectory,
          expectedEntries: [],
          timeoutMs: 1_000,
        });
      } finally {
        signalController.abort();
        await Promise.all([
          tunnelClient.close(),
          rm(expectedAttachmentDirectory, { force: true, recursive: true }),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "removes partial upload files when the tunnel websocket closes mid-upload",
    async () => {
      const threadId = `thread_${randomUUID()}`;
      const expectedBytes = ImageSignatures.PNG;
      const partialBytes = expectedBytes.subarray(0, Math.floor(expectedBytes.byteLength / 2));
      const expectedAttachmentDirectory = join("/tmp/attachments", threadId);

      await mkdir(expectedAttachmentDirectory, { recursive: true });
      await rm(expectedAttachmentDirectory, { force: true, recursive: true });

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

      const signalController = new AbortController();
      const tunnelClient = startTunnelClient({
        signal: signalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      const gatewayConnection = await waitForGatewayConnection(wsServer);
      const stepSignal = AbortSignal.timeout(StepTimeoutMs);

      try {
        gatewayConnection.socket.send(
          JSON.stringify({
            type: "stream.open",
            streamId: 17,
            channel: {
              kind: "fileUpload",
              threadId,
              mimeType: "image/png",
              originalFilename: "partial-upload.png",
              sizeBytes: expectedBytes.byteLength,
            },
          }),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: gatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for stream.open.ok",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.open.ok",
          streamId: 17,
        });

        gatewayConnection.socket.send(
          Buffer.from(
            encodeDataFrame({
              streamId: 17,
              payloadKind: PayloadKindRawBytes,
              payload: partialBytes,
            }),
          ),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: gatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for stream.window",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.window",
          streamId: 17,
          bytes: partialBytes.byteLength,
        });

        await closeWebSocket(gatewayConnection.socket);
        await waitForAttachmentDirectoryEntries({
          path: expectedAttachmentDirectory,
          expectedEntries: [],
          timeoutMs: 1_000,
        });
      } finally {
        signalController.abort();
        await Promise.all([
          tunnelClient.close(),
          rm(expectedAttachmentDirectory, { force: true, recursive: true }),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "does not emit completion and leaves no files when the tunnel websocket closes after all bytes arrive but before stream.close",
    async () => {
      const threadId = `thread_${randomUUID()}`;
      const expectedBytes = ImageSignatures.PNG;
      const expectedAttachmentDirectory = join("/tmp/attachments", threadId);

      await mkdir(expectedAttachmentDirectory, { recursive: true });
      await rm(expectedAttachmentDirectory, { force: true, recursive: true });

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

      const signalController = new AbortController();
      const tunnelClient = startTunnelClient({
        signal: signalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      const gatewayConnection = await waitForGatewayConnection(wsServer);
      const stepSignal = AbortSignal.timeout(StepTimeoutMs);

      try {
        gatewayConnection.socket.send(
          JSON.stringify({
            type: "stream.open",
            streamId: 41,
            channel: {
              kind: "fileUpload",
              threadId,
              mimeType: "image/png",
              originalFilename: "all-bytes-no-close.png",
              sizeBytes: expectedBytes.byteLength,
            },
          }),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: gatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for stream.open.ok",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.open.ok",
          streamId: 41,
        });

        gatewayConnection.socket.send(
          Buffer.from(
            encodeDataFrame({
              streamId: 41,
              payloadKind: PayloadKindRawBytes,
              payload: expectedBytes,
            }),
          ),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: gatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for stream.window",
              tunnelCompletion: tunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.window",
          streamId: 41,
          bytes: expectedBytes.byteLength,
        });

        await closeWebSocket(gatewayConnection.socket);
        await waitForAttachmentDirectoryEntries({
          path: expectedAttachmentDirectory,
          expectedEntries: [],
          timeoutMs: 1_000,
        });
      } finally {
        signalController.abort();
        await Promise.all([
          tunnelClient.close(),
          rm(expectedAttachmentDirectory, { force: true, recursive: true }),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "allows a fresh upload after a mid-upload disconnect cleanup",
    async () => {
      const threadId = `thread_${randomUUID()}`;
      const expectedBytes = ImageSignatures.PNG;
      const partialBytes = expectedBytes.subarray(0, Math.floor(expectedBytes.byteLength / 2));
      const expectedAttachmentDirectory = join("/tmp/attachments", threadId);

      await mkdir(expectedAttachmentDirectory, { recursive: true });
      await rm(expectedAttachmentDirectory, { force: true, recursive: true });

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

      const firstSignalController = new AbortController();
      const firstTunnelClient = startTunnelClient({
        signal: firstSignalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      const firstGatewayConnection = await waitForGatewayConnection(wsServer);
      const stepSignal = AbortSignal.timeout(StepTimeoutMs);

      try {
        firstGatewayConnection.socket.send(
          JSON.stringify({
            type: "stream.open",
            streamId: 17,
            channel: {
              kind: "fileUpload",
              threadId,
              mimeType: "image/png",
              originalFilename: "partial-upload.png",
              sizeBytes: expectedBytes.byteLength,
            },
          }),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: firstGatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for initial stream.open.ok",
              tunnelCompletion: firstTunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.open.ok",
          streamId: 17,
        });

        firstGatewayConnection.socket.send(
          Buffer.from(
            encodeDataFrame({
              streamId: 17,
              payloadKind: PayloadKindRawBytes,
              payload: partialBytes,
            }),
          ),
        );

        expect(
          parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: firstGatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for initial stream.window",
              tunnelCompletion: firstTunnelClient.completion,
            }),
          ),
        ).toEqual({
          type: "stream.window",
          streamId: 17,
          bytes: partialBytes.byteLength,
        });

        await closeWebSocket(firstGatewayConnection.socket);
        await waitForAttachmentDirectoryEntries({
          path: expectedAttachmentDirectory,
          expectedEntries: [],
          timeoutMs: 1_000,
        });

        firstSignalController.abort();
        await firstTunnelClient.close();

        const secondSignalController = new AbortController();
        const secondTunnelClient = startTunnelClient({
          signal: secondSignalController.signal,
          gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
          bootstrapToken: "bootstrap-token",
          tunnelExchangeToken: "exchange-token",
          agentRuntimes: [],
          runtimeClients: [],
        });
        const secondGatewayConnection = await waitForGatewayConnection(wsServer);

        try {
          secondGatewayConnection.socket.send(
            JSON.stringify({
              type: "stream.open",
              streamId: 23,
              channel: {
                kind: "fileUpload",
                threadId,
                mimeType: "image/png",
                originalFilename: "retry-upload.png",
                sizeBytes: expectedBytes.byteLength,
              },
            }),
          );

          expect(
            parseTextMessage(
              await nextQueueItemOrTunnelCompletion({
                queue: secondGatewayConnection.messageQueue,
                signal: stepSignal,
                label: "waiting for retry stream.open.ok",
                tunnelCompletion: secondTunnelClient.completion,
              }),
            ),
          ).toEqual({
            type: "stream.open.ok",
            streamId: 23,
          });

          secondGatewayConnection.socket.send(
            Buffer.from(
              encodeDataFrame({
                streamId: 23,
                payloadKind: PayloadKindRawBytes,
                payload: expectedBytes,
              }),
            ),
          );

          expect(
            parseTextMessage(
              await nextQueueItemOrTunnelCompletion({
                queue: secondGatewayConnection.messageQueue,
                signal: stepSignal,
                label: "waiting for retry stream.window",
                tunnelCompletion: secondTunnelClient.completion,
              }),
            ),
          ).toEqual({
            type: "stream.window",
            streamId: 23,
            bytes: expectedBytes.byteLength,
          });

          secondGatewayConnection.socket.send(
            JSON.stringify({
              type: "stream.close",
              streamId: 23,
            }),
          );

          const completionMessage = parseTextMessage(
            await nextQueueItemOrTunnelCompletion({
              queue: secondGatewayConnection.messageQueue,
              signal: stepSignal,
              label: "waiting for retry fileUpload.completed",
              tunnelCompletion: secondTunnelClient.completion,
            }),
          );
          expect(completionMessage.type).toBe("stream.event");
          expect(completionMessage.streamId).toBe(23);

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
            originalFilename: "retry-upload.png",
            mimeType: "image/png",
            sizeBytes: expectedBytes.byteLength,
          });

          const uploadedPath = typeof event?.path === "string" ? event.path : null;
          if (uploadedPath === null) {
            throw new Error("expected retry fileUpload.completed event to include a path");
          }

          expect(Array.from(await readFile(uploadedPath))).toEqual(Array.from(expectedBytes));
          expect(await listAttachmentDirectoryEntries(expectedAttachmentDirectory)).toEqual([
            uploadedPath.split("/").at(-1),
          ]);

          await closeWebSocket(secondGatewayConnection.socket);
        } finally {
          secondSignalController.abort();
          await secondTunnelClient.close();
        }
      } finally {
        firstSignalController.abort();
        await Promise.all([
          firstTunnelClient.close(),
          rm(expectedAttachmentDirectory, { force: true, recursive: true }),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
