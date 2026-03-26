import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeDataFrame,
  FileUploadResetCodes,
  parseStreamControlMessage,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import type { ActiveTunnelStreamRelayResult } from "./active-relay.js";
import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import { handleFileUploadConnectRequest, handleFileUploadStream } from "./file-upload-channel.js";
import { ImageSignatures } from "./validate-uploaded-image.js";

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

async function closeClientSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

type OpenServer = {
  cleanup: () => Promise<void>;
  tempRoot: string;
};

const openServers = new Set<OpenServer>();

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.cleanup()));
  openServers.clear();
});

describe("handleFileUploadStream", () => {
  it("writes uploaded bytes to a thread-scoped file and emits completion", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mistle-file-upload-test-"));
    const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wsServer.once("listening", () => resolve());
      wsServer.once("error", (error) => reject(error));
    });
    const cleanup = async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
      await rm(tempRoot, { force: true, recursive: true });
    };
    openServers.add({ cleanup, tempRoot });

    const messages = new AsyncQueue<TunnelSocketMessage>();
    wsServer.on("connection", (socket) => {
      void handleFileUploadStream({
        attachmentRootPath: tempRoot,
        messages,
        streamId: 7,
        threadId: "thread_123",
        mimeType: "image/png",
        originalFilename: "screenshot.png",
        sizeBytes: ImageSignatures.PNG.byteLength,
        tunnelSocket: socket,
      }).catch(() => undefined);
    });

    const address = wsServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected websocket server to expose a concrete socket address.");
    }

    const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
    const completionMessage = new Promise<{ path: string }>((resolve, reject) => {
      clientSocket.on("message", (message) => {
        const controlMessage = parseStreamControlMessage(toText(message));
        if (
          controlMessage?.type === "stream.event" &&
          controlMessage.event.type === "fileUpload.completed"
        ) {
          resolve({ path: controlMessage.event.path });
        }
      });
      clientSocket.on("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      clientSocket.once("open", () => resolve());
      clientSocket.once("error", (error) => reject(error));
    });

    messages.push({
      kind: "binary",
      payload: encodeDataFrame({
        streamId: 7,
        payloadKind: PayloadKindRawBytes,
        payload: ImageSignatures.PNG,
      }),
    });
    messages.push({
      kind: "text",
      payload: JSON.stringify({
        type: "stream.close",
        streamId: 7,
      }),
    });

    const completion = await completionMessage;
    const storedBytes = await readFile(completion.path);
    expect(Array.from(storedBytes)).toEqual(Array.from(ImageSignatures.PNG));
    expect(completion.path.startsWith(join(tempRoot, "thread_123"))).toBe(true);

    await closeClientSocket(clientSocket);
  });

  it("replenishes stream window credit for multi-chunk uploads", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mistle-file-upload-window-test-"));
    const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wsServer.once("listening", () => resolve());
      wsServer.once("error", (error) => reject(error));
    });
    const cleanup = async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
      await rm(tempRoot, { force: true, recursive: true });
    };
    openServers.add({ cleanup, tempRoot });

    const messages = new AsyncQueue<TunnelSocketMessage>();
    wsServer.on("connection", (socket) => {
      void handleFileUploadStream({
        attachmentRootPath: tempRoot,
        messages,
        streamId: 9,
        threadId: "thread_window",
        mimeType: "image/png",
        originalFilename: "large.png",
        sizeBytes: ImageSignatures.PNG.byteLength,
        tunnelSocket: socket,
      }).catch(() => undefined);
    });

    const address = wsServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected websocket server to expose a concrete socket address.");
    }

    const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
    const observedWindows = new Promise<number[]>((resolve, reject) => {
      const windows: number[] = [];
      clientSocket.on("message", (message) => {
        const controlMessage = parseStreamControlMessage(toText(message));
        if (controlMessage?.type === "stream.window") {
          windows.push(controlMessage.bytes);
          if (windows.length === 2) {
            resolve(windows);
          }
        }
      });
      clientSocket.on("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      clientSocket.once("open", () => resolve());
      clientSocket.once("error", (error) => reject(error));
    });

    messages.push({
      kind: "binary",
      payload: encodeDataFrame({
        streamId: 9,
        payloadKind: PayloadKindRawBytes,
        payload: ImageSignatures.PNG.subarray(0, 4),
      }),
    });
    messages.push({
      kind: "binary",
      payload: encodeDataFrame({
        streamId: 9,
        payloadKind: PayloadKindRawBytes,
        payload: ImageSignatures.PNG.subarray(4),
      }),
    });
    messages.push({
      kind: "text",
      payload: JSON.stringify({
        type: "stream.close",
        streamId: 9,
      }),
    });

    await expect(observedWindows).resolves.toEqual([4, 4]);
    await closeClientSocket(clientSocket);
  });

  it("rejects random bytes labeled as an image and removes the temp file", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mistle-file-upload-invalid-test-"));
    const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wsServer.once("listening", () => resolve());
      wsServer.once("error", (error) => reject(error));
    });
    const cleanup = async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
      await rm(tempRoot, { force: true, recursive: true });
    };
    openServers.add({ cleanup, tempRoot });

    const messages = new AsyncQueue<TunnelSocketMessage>();
    wsServer.on("connection", (socket) => {
      void handleFileUploadStream({
        attachmentRootPath: tempRoot,
        messages,
        streamId: 13,
        threadId: "thread_invalid",
        mimeType: "image/png",
        originalFilename: "invalid.png",
        sizeBytes: 4,
        tunnelSocket: socket,
      }).catch(() => undefined);
    });

    const address = wsServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected websocket server to expose a concrete socket address.");
    }

    const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
    const resetMessage = new Promise<ReturnType<typeof parseStreamControlMessage>>(
      (resolve, reject) => {
        clientSocket.on("message", (message) => {
          const controlMessage = parseStreamControlMessage(toText(message));
          if (controlMessage?.type === "stream.reset") {
            resolve(controlMessage);
          }
        });
        clientSocket.on("error", reject);
      },
    );
    await new Promise<void>((resolve, reject) => {
      clientSocket.once("open", () => resolve());
      clientSocket.once("error", (error) => reject(error));
    });

    messages.push({
      kind: "binary",
      payload: encodeDataFrame({
        streamId: 13,
        payloadKind: PayloadKindRawBytes,
        payload: new Uint8Array([1, 2, 3, 4]),
      }),
    });
    messages.push({
      kind: "text",
      payload: JSON.stringify({
        type: "stream.close",
        streamId: 13,
      }),
    });

    await expect(resetMessage).resolves.toMatchObject({
      type: "stream.reset",
      streamId: 13,
      code: FileUploadResetCodes.INVALID_FILE_TYPE,
    });
    await expect.poll(async () => await readdir(join(tempRoot, "thread_invalid"))).toEqual([]);

    await closeClientSocket(clientSocket);
  });

  it("rejects a MIME mismatch and removes the temp file", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mistle-file-upload-mismatch-test-"));
    const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wsServer.once("listening", () => resolve());
      wsServer.once("error", (error) => reject(error));
    });
    const cleanup = async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
      await rm(tempRoot, { force: true, recursive: true });
    };
    openServers.add({ cleanup, tempRoot });

    const messages = new AsyncQueue<TunnelSocketMessage>();
    wsServer.on("connection", (socket) => {
      void handleFileUploadStream({
        attachmentRootPath: tempRoot,
        messages,
        streamId: 15,
        threadId: "thread_mismatch",
        mimeType: "image/jpeg",
        originalFilename: "mismatch.jpg",
        sizeBytes: ImageSignatures.PNG.byteLength,
        tunnelSocket: socket,
      }).catch(() => undefined);
    });

    const address = wsServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected websocket server to expose a concrete socket address.");
    }

    const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
    const resetMessage = new Promise<ReturnType<typeof parseStreamControlMessage>>(
      (resolve, reject) => {
        clientSocket.on("message", (message) => {
          const controlMessage = parseStreamControlMessage(toText(message));
          if (controlMessage?.type === "stream.reset") {
            resolve(controlMessage);
          }
        });
        clientSocket.on("error", reject);
      },
    );
    await new Promise<void>((resolve, reject) => {
      clientSocket.once("open", () => resolve());
      clientSocket.once("error", (error) => reject(error));
    });

    messages.push({
      kind: "binary",
      payload: encodeDataFrame({
        streamId: 15,
        payloadKind: PayloadKindRawBytes,
        payload: ImageSignatures.PNG,
      }),
    });
    messages.push({
      kind: "text",
      payload: JSON.stringify({
        type: "stream.close",
        streamId: 15,
      }),
    });

    await expect(resetMessage).resolves.toMatchObject({
      type: "stream.reset",
      streamId: 15,
      code: FileUploadResetCodes.MIME_TYPE_MISMATCH,
    });
    await expect.poll(async () => await readdir(join(tempRoot, "thread_mismatch"))).toEqual([]);

    await closeClientSocket(clientSocket);
  });
});

describe("handleFileUploadConnectRequest", () => {
  it("opens a file upload relay from a valid stream.open request", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mistle-file-upload-connect-test-"));
    const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wsServer.once("listening", () => resolve());
      wsServer.once("error", (error) => reject(error));
    });
    const cleanup = async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
      await rm(tempRoot, { force: true, recursive: true });
    };
    openServers.add({ cleanup, tempRoot });

    const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
    wsServer.on("connection", (socket) => {
      void handleFileUploadConnectRequest({
        signal: AbortSignal.timeout(1_000),
        tunnelSocket: socket,
        rawPayload: JSON.stringify({
          type: "stream.open",
          streamId: 11,
          channel: {
            kind: "fileUpload",
            threadId: "thread_456",
            mimeType: "image/png",
            originalFilename: "diagram.png",
            sizeBytes: ImageSignatures.PNG.byteLength,
          },
        }),
        streamId: 11,
        relayResultQueue,
        attachmentRootPath: tempRoot,
      })
        .then((relay) => {
          if (relay === undefined) {
            throw new Error("Expected a file upload relay to be created.");
          }

          relay.messages.push({
            kind: "binary",
            payload: encodeDataFrame({
              streamId: 11,
              payloadKind: PayloadKindRawBytes,
              payload: ImageSignatures.PNG,
            }),
          });
          relay.messages.push({
            kind: "text",
            payload: JSON.stringify({
              type: "stream.close",
              streamId: 11,
            }),
          });
        })
        .catch(() => undefined);
    });

    const address = wsServer.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected websocket server to expose a concrete socket address.");
    }

    const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
    const completionMessage = new Promise<{ path: string }>((resolve, reject) => {
      clientSocket.on("message", (message) => {
        const controlMessage = parseStreamControlMessage(toText(message));
        if (
          controlMessage?.type === "stream.event" &&
          controlMessage.event.type === "fileUpload.completed"
        ) {
          resolve({ path: controlMessage.event.path });
        }
      });
      clientSocket.on("error", reject);
    });
    await new Promise<void>((resolve, rejectOpen) => {
      clientSocket.once("open", () => resolve());
      clientSocket.once("error", (error) => rejectOpen(error));
    });

    const completion = await completionMessage;
    const relayResult = await relayResultQueue.next();
    if (relayResult.error !== undefined) {
      throw relayResult.error;
    }

    const storedBytes = await readFile(completion.path);
    expect(Array.from(storedBytes)).toEqual(Array.from(ImageSignatures.PNG));
    expect(completion.path.startsWith(join(tempRoot, "thread_456"))).toBe(true);

    await closeClientSocket(clientSocket);
  });
});
