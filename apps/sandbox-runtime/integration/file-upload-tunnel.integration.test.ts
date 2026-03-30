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

type ConnectedGatewaySocket = {
  messageQueue: AsyncQueue<TunnelSocketMessage>;
  socket: WebSocket;
};

type UploadHarness = {
  attachmentDirectoryPath: string;
  cleanup: () => Promise<void>;
  connect: () => Promise<ConnectedGatewaySocket>;
  expectAttachmentEntries: (expectedEntries: string[]) => Promise<void>;
  startTunnel: () => StartedUploadTunnelClient;
  threadId: string;
};

type StartedUploadTunnelClient = {
  close: () => Promise<void>;
  completion: ReturnType<typeof startTunnelClient>["completion"];
  connection: Promise<ConnectedGatewaySocket>;
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

async function createUploadHarness(input?: { threadId?: string }): Promise<UploadHarness> {
  const threadId = input?.threadId ?? `thread_${randomUUID()}`;
  const attachmentDirectoryPath = join("/tmp/attachments", threadId);

  await mkdir(attachmentDirectoryPath, { recursive: true });
  await rm(attachmentDirectoryPath, { force: true, recursive: true });

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

  return {
    attachmentDirectoryPath,
    cleanup: async () => {
      await rm(attachmentDirectoryPath, { force: true, recursive: true });
    },
    connect: async () => await waitForGatewayConnection(wsServer),
    expectAttachmentEntries: async (expectedEntries) => {
      await waitForAttachmentDirectoryEntries({
        path: attachmentDirectoryPath,
        expectedEntries,
        timeoutMs: 1_000,
      });
    },
    startTunnel: () => {
      const signalController = new AbortController();
      const tunnelClient = startTunnelClient({
        signal: signalController.signal,
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(wsServer))}/tunnel/sandbox`,
        bootstrapToken: "bootstrap-token",
        tunnelExchangeToken: "exchange-token",
        agentRuntimes: [],
        runtimeClients: [],
      });

      return {
        close: async () => {
          signalController.abort();
          await tunnelClient.close();
        },
        completion: tunnelClient.completion,
        connection: waitForGatewayConnection(wsServer),
      };
    },
    threadId,
  };
}

function createUploadOpenPayload(input: {
  mimeType?: string;
  originalFilename: string;
  sizeBytes: number;
  streamId: number;
  threadId: string;
}): string {
  return JSON.stringify({
    type: "stream.open",
    streamId: input.streamId,
    channel: {
      kind: "fileUpload",
      threadId: input.threadId,
      mimeType: input.mimeType ?? "image/png",
      originalFilename: input.originalFilename,
      sizeBytes: input.sizeBytes,
    },
  });
}

async function expectStreamOpenOk(input: {
  connection: ConnectedGatewaySocket;
  streamId: number;
  tunnelCompletion: StartedUploadTunnelClient["completion"];
}): Promise<void> {
  expect(
    parseTextMessage(
      await nextQueueItemOrTunnelCompletion({
        queue: input.connection.messageQueue,
        signal: AbortSignal.timeout(StepTimeoutMs),
        label: "waiting for stream.open.ok",
        tunnelCompletion: input.tunnelCompletion,
      }),
    ),
  ).toEqual({
    type: "stream.open.ok",
    streamId: input.streamId,
  });
}

async function sendUploadBytes(input: {
  connection: ConnectedGatewaySocket;
  payload: Uint8Array;
  streamId: number;
  tunnelCompletion: StartedUploadTunnelClient["completion"];
}): Promise<void> {
  input.connection.socket.send(
    Buffer.from(
      encodeDataFrame({
        streamId: input.streamId,
        payloadKind: PayloadKindRawBytes,
        payload: input.payload,
      }),
    ),
  );

  expect(
    parseTextMessage(
      await nextQueueItemOrTunnelCompletion({
        queue: input.connection.messageQueue,
        signal: AbortSignal.timeout(StepTimeoutMs),
        label: "waiting for stream.window",
        tunnelCompletion: input.tunnelCompletion,
      }),
    ),
  ).toEqual({
    type: "stream.window",
    streamId: input.streamId,
    bytes: input.payload.byteLength,
  });
}

function closeUploadStream(connection: ConnectedGatewaySocket, streamId: number): void {
  connection.socket.send(
    JSON.stringify({
      type: "stream.close",
      streamId,
    }),
  );
}

async function expectUploadCompleted(input: {
  connection: ConnectedGatewaySocket;
  streamId: number;
  tunnelCompletion: StartedUploadTunnelClient["completion"];
}): Promise<Record<string, unknown>> {
  const completionMessage = parseTextMessage(
    await nextQueueItemOrTunnelCompletion({
      queue: input.connection.messageQueue,
      signal: AbortSignal.timeout(StepTimeoutMs),
      label: "waiting for fileUpload.completed",
      tunnelCompletion: input.tunnelCompletion,
    }),
  );
  expect(completionMessage.type).toBe("stream.event");
  expect(completionMessage.streamId).toBe(input.streamId);

  const event =
    typeof completionMessage.event === "object" &&
    completionMessage.event !== null &&
    !Array.isArray(completionMessage.event)
      ? Object.fromEntries(Object.entries(completionMessage.event))
      : null;
  if (event === null) {
    throw new Error("expected fileUpload.completed event payload");
  }

  const terminalMessage = parseTextMessage(
    await nextQueueItemOrTunnelCompletion({
      queue: input.connection.messageQueue,
      signal: AbortSignal.timeout(StepTimeoutMs),
      label: "waiting for stream.complete",
      tunnelCompletion: input.tunnelCompletion,
    }),
  );
  expect(terminalMessage).toEqual({
    type: "stream.complete",
    streamId: input.streamId,
  });

  return event;
}

describe("startTunnelClient fileUpload integration", () => {
  it(
    "handles a fileUpload stream end to end and emits fileUpload.completed",
    async () => {
      const harness = await createUploadHarness();
      const tunnel = harness.startTunnel();
      const gatewayConnection = await tunnel.connection;
      const expectedBytes = ImageSignatures.PNG;

      try {
        gatewayConnection.socket.send(
          createUploadOpenPayload({
            originalFilename: "upload.png",
            sizeBytes: expectedBytes.byteLength,
            streamId: 17,
            threadId: harness.threadId,
          }),
        );
        await expectStreamOpenOk({
          connection: gatewayConnection,
          streamId: 17,
          tunnelCompletion: tunnel.completion,
        });
        await sendUploadBytes({
          connection: gatewayConnection,
          payload: expectedBytes,
          streamId: 17,
          tunnelCompletion: tunnel.completion,
        });
        closeUploadStream(gatewayConnection, 17);

        const event = await expectUploadCompleted({
          connection: gatewayConnection,
          streamId: 17,
          tunnelCompletion: tunnel.completion,
        });
        expect(event).toMatchObject({
          type: "fileUpload.completed",
          threadId: harness.threadId,
          originalFilename: "upload.png",
          mimeType: "image/png",
          sizeBytes: expectedBytes.byteLength,
        });

        const uploadedPath = typeof event.path === "string" ? event.path : null;
        if (uploadedPath === null) {
          throw new Error("expected fileUpload.completed event to include a path");
        }

        expect(uploadedPath.startsWith(harness.attachmentDirectoryPath)).toBe(true);
        expect(Array.from(await readFile(uploadedPath))).toEqual(Array.from(expectedBytes));
      } finally {
        await Promise.all([
          tunnel.close(),
          closeWebSocket(gatewayConnection.socket),
          harness.cleanup(),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "does not emit completion and leaves no files when the tunnel websocket closes after open but before upload bytes",
    async () => {
      const harness = await createUploadHarness();
      const tunnel = harness.startTunnel();
      const gatewayConnection = await tunnel.connection;

      try {
        gatewayConnection.socket.send(
          createUploadOpenPayload({
            originalFilename: "no-bytes.png",
            sizeBytes: ImageSignatures.PNG.byteLength,
            streamId: 31,
            threadId: harness.threadId,
          }),
        );
        await expectStreamOpenOk({
          connection: gatewayConnection,
          streamId: 31,
          tunnelCompletion: tunnel.completion,
        });

        await closeWebSocket(gatewayConnection.socket);
        await harness.expectAttachmentEntries([]);
      } finally {
        await Promise.all([tunnel.close(), harness.cleanup()]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "removes partial upload files when the tunnel websocket closes mid-upload",
    async () => {
      const harness = await createUploadHarness();
      const tunnel = harness.startTunnel();
      const gatewayConnection = await tunnel.connection;
      const expectedBytes = ImageSignatures.PNG;
      const partialBytes = expectedBytes.subarray(0, Math.floor(expectedBytes.byteLength / 2));

      try {
        gatewayConnection.socket.send(
          createUploadOpenPayload({
            originalFilename: "partial-upload.png",
            sizeBytes: expectedBytes.byteLength,
            streamId: 17,
            threadId: harness.threadId,
          }),
        );
        await expectStreamOpenOk({
          connection: gatewayConnection,
          streamId: 17,
          tunnelCompletion: tunnel.completion,
        });
        await sendUploadBytes({
          connection: gatewayConnection,
          payload: partialBytes,
          streamId: 17,
          tunnelCompletion: tunnel.completion,
        });

        await closeWebSocket(gatewayConnection.socket);
        await harness.expectAttachmentEntries([]);
      } finally {
        await Promise.all([tunnel.close(), harness.cleanup()]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "does not emit completion and leaves no files when the tunnel websocket closes after all bytes arrive but before stream.close",
    async () => {
      const harness = await createUploadHarness();
      const tunnel = harness.startTunnel();
      const gatewayConnection = await tunnel.connection;
      const expectedBytes = ImageSignatures.PNG;

      try {
        gatewayConnection.socket.send(
          createUploadOpenPayload({
            originalFilename: "all-bytes-no-close.png",
            sizeBytes: expectedBytes.byteLength,
            streamId: 41,
            threadId: harness.threadId,
          }),
        );
        await expectStreamOpenOk({
          connection: gatewayConnection,
          streamId: 41,
          tunnelCompletion: tunnel.completion,
        });
        await sendUploadBytes({
          connection: gatewayConnection,
          payload: expectedBytes,
          streamId: 41,
          tunnelCompletion: tunnel.completion,
        });

        await closeWebSocket(gatewayConnection.socket);
        await harness.expectAttachmentEntries([]);
      } finally {
        await Promise.all([tunnel.close(), harness.cleanup()]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "allows a fresh upload after a mid-upload disconnect cleanup",
    async () => {
      const harness = await createUploadHarness();
      const expectedBytes = ImageSignatures.PNG;
      const partialBytes = expectedBytes.subarray(0, Math.floor(expectedBytes.byteLength / 2));

      const firstTunnel = harness.startTunnel();
      const firstGatewayConnection = await firstTunnel.connection;

      try {
        firstGatewayConnection.socket.send(
          createUploadOpenPayload({
            originalFilename: "partial-upload.png",
            sizeBytes: expectedBytes.byteLength,
            streamId: 17,
            threadId: harness.threadId,
          }),
        );
        await expectStreamOpenOk({
          connection: firstGatewayConnection,
          streamId: 17,
          tunnelCompletion: firstTunnel.completion,
        });
        await sendUploadBytes({
          connection: firstGatewayConnection,
          payload: partialBytes,
          streamId: 17,
          tunnelCompletion: firstTunnel.completion,
        });

        await closeWebSocket(firstGatewayConnection.socket);
        await harness.expectAttachmentEntries([]);
        await firstTunnel.close();

        const secondTunnel = harness.startTunnel();
        const secondGatewayConnection = await secondTunnel.connection;

        try {
          secondGatewayConnection.socket.send(
            createUploadOpenPayload({
              originalFilename: "retry-upload.png",
              sizeBytes: expectedBytes.byteLength,
              streamId: 23,
              threadId: harness.threadId,
            }),
          );
          await expectStreamOpenOk({
            connection: secondGatewayConnection,
            streamId: 23,
            tunnelCompletion: secondTunnel.completion,
          });
          await sendUploadBytes({
            connection: secondGatewayConnection,
            payload: expectedBytes,
            streamId: 23,
            tunnelCompletion: secondTunnel.completion,
          });
          closeUploadStream(secondGatewayConnection, 23);

          const event = await expectUploadCompleted({
            connection: secondGatewayConnection,
            streamId: 23,
            tunnelCompletion: secondTunnel.completion,
          });
          expect(event).toMatchObject({
            type: "fileUpload.completed",
            threadId: harness.threadId,
            originalFilename: "retry-upload.png",
            mimeType: "image/png",
            sizeBytes: expectedBytes.byteLength,
          });

          const uploadedPath = typeof event.path === "string" ? event.path : null;
          if (uploadedPath === null) {
            throw new Error("expected retry fileUpload.completed event to include a path");
          }

          expect(Array.from(await readFile(uploadedPath))).toEqual(Array.from(expectedBytes));
          expect(await listAttachmentDirectoryEntries(harness.attachmentDirectoryPath)).toEqual([
            uploadedPath.split("/").at(-1),
          ]);

          await closeWebSocket(secondGatewayConnection.socket);
        } finally {
          await secondTunnel.close();
        }
      } finally {
        await Promise.all([firstTunnel.close(), harness.cleanup()]);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
