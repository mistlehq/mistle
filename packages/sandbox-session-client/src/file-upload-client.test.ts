import {
  decodeDataFrame,
  FileUploadResetCodes,
  parseStreamControlMessage,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";

import { FileUploadRejectedError, UploadStreamClient } from "./file-upload-client.js";
import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxSessionTransport } from "./transport.js";

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

type TestUploadServer = {
  close: () => Promise<void>;
  receivedBytes: () => Uint8Array;
  url: string;
};

type UploadServerBehavior =
  | {
      kind: "accept";
    }
  | {
      kind: "complete_without_event";
    }
  | {
      kind: "reset_after_close";
      code: string;
      message: string;
    };

function createUploadServerBehavior(behavior?: UploadServerBehavior): UploadServerBehavior {
  return behavior ?? { kind: "accept" };
}

function createImageFile(input?: { bytes?: Uint8Array; name?: string }): File {
  const rawBytes = input?.bytes ?? new Uint8Array([1, 2, 3, 4]);
  const fileBytes = new Uint8Array(rawBytes.byteLength);
  fileBytes.set(rawBytes);

  return new File([fileBytes], input?.name ?? "screenshot.png", {
    type: "image/png",
  });
}

function sendControlMessage(socket: WebSocket, message: object): void {
  socket.send(JSON.stringify(message));
}

function sendStreamOpenResponse(socket: WebSocket, streamId: number): void {
  sendControlMessage(socket, {
    type: "stream.open.ok",
    streamId,
  });
}

function sendStreamReset(
  socket: WebSocket,
  input: { code: string; message: string; streamId: number },
): void {
  sendControlMessage(socket, {
    type: "stream.reset",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  });
}

function sendFileUploadCompleted(
  socket: WebSocket,
  input: { sizeBytes: number; streamId: number },
): void {
  sendControlMessage(socket, {
    type: "stream.event",
    streamId: input.streamId,
    event: {
      type: "fileUpload.completed",
      attachmentId: "att_123",
      threadId: "thread_123",
      originalFilename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: input.sizeBytes,
      path: "/root/.local/attachments/thread_123/upload.png",
    },
  });
}

function sendStreamComplete(socket: WebSocket, streamId: number): void {
  sendControlMessage(socket, {
    type: "stream.complete",
    streamId,
  });
}

function sendStreamWindow(socket: WebSocket, input: { bytes: number; streamId: number }): void {
  sendControlMessage(socket, {
    type: "stream.window",
    streamId: input.streamId,
    bytes: input.bytes,
  });
}

async function startUploadTestServer(input?: {
  behavior?: UploadServerBehavior;
}): Promise<TestUploadServer> {
  const behavior = createUploadServerBehavior(input?.behavior);
  const receivedChunks: Uint8Array[] = [];
  const openSockets = new Set<WebSocket>();
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
    });

    let streamId: number | null = null;

    socket.on("message", (message) => {
      const controlMessage = parseStreamControlMessage(toText(message));
      if (controlMessage?.type === "stream.open") {
        streamId = controlMessage.streamId;
        sendStreamOpenResponse(socket, streamId);
        return;
      }

      if (controlMessage?.type === "stream.close" && streamId !== null) {
        if (behavior.kind === "reset_after_close") {
          sendStreamReset(socket, {
            streamId,
            code: behavior.code,
            message: behavior.message,
          });
          return;
        }
        if (behavior.kind === "complete_without_event") {
          sendStreamComplete(socket, streamId);
          return;
        }

        sendFileUploadCompleted(socket, {
          streamId,
          sizeBytes: receivedChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
        });
        sendStreamComplete(socket, streamId);
        return;
      }

      const dataFrame = decodeDataFrame(toUint8Array(message));
      if (dataFrame.payloadKind !== PayloadKindRawBytes) {
        throw new Error("Expected raw bytes payload kind.");
      }

      receivedChunks.push(dataFrame.payload);
      if (streamId !== null) {
        sendStreamWindow(socket, {
          streamId,
          bytes: dataFrame.payload.byteLength,
        });
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    close: async () => {
      for (const socket of openSockets) {
        socket.close();
      }
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
    receivedBytes: () => {
      return Uint8Array.from(receivedChunks.flatMap((chunk) => Array.from(chunk)));
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

async function connectTransport(connectionUrl: string): Promise<SandboxSessionTransport> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  await transport.connect({
    connectionUrl,
  });
  return transport;
}

const openServers = new Set<TestUploadServer>();

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("UploadStreamClient", () => {
  it("uploads file bytes over a shared transport and resolves with the completed upload result", async () => {
    const server = await startUploadTestServer();
    openServers.add(server);
    const transport = await connectTransport(server.url);
    const client = new UploadStreamClient({
      transport,
    });

    await expect(
      client.uploadImage({
        file: createImageFile(),
        threadId: "thread_123",
      }),
    ).resolves.toEqual({
      attachmentId: "att_123",
      threadId: "thread_123",
      originalFilename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 4,
      path: "/root/.local/attachments/thread_123/upload.png",
    });
    expect(Array.from(server.receivedBytes())).toEqual([1, 2, 3, 4]);

    transport.disconnect(1000, "Test completed.");
  });

  it("preserves reset codes when the shared upload stream is rejected", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "reset_after_close",
        code: FileUploadResetCodes.INVALID_FILE_TYPE,
        message: "Uploaded file is not a supported image.",
      },
    });
    openServers.add(server);
    const transport = await connectTransport(server.url);
    const client = new UploadStreamClient({
      transport,
    });

    await expect(
      client.uploadImage({
        file: createImageFile(),
        threadId: "thread_123",
      }),
    ).rejects.toMatchObject({
      name: "FileUploadRejectedError",
      code: FileUploadResetCodes.INVALID_FILE_TYPE,
      message: "Uploaded file is not a supported image.",
    } satisfies Pick<FileUploadRejectedError, "code" | "message" | "name">);

    transport.disconnect(1000, "Test completed.");
  });

  it("rejects when stream.complete arrives before fileUpload.completed", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "complete_without_event",
      },
    });
    openServers.add(server);
    const transport = await connectTransport(server.url);
    const client = new UploadStreamClient({
      transport,
    });

    await expect(
      client.uploadImage({
        file: createImageFile(),
        threadId: "thread_123",
      }),
    ).rejects.toThrow("Received stream.complete before file upload completion event.");

    transport.disconnect(1000, "Test completed.");
  });
});
