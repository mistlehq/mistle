import {
  decodeDataFrame,
  FileUploadResetCodes,
  parseStreamControlMessage,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";

import { createBrowserSandboxSessionRuntime } from "./browser.js";
import { FileUploadRejectedError, uploadSandboxImage } from "./file-upload-client.js";

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
      kind: "close_after_open";
    }
  | {
      kind: "event_without_complete";
    }
  | {
      kind: "reject_open";
      code: string;
      message: string;
    }
  | {
      kind: "reset_after_close";
      code: string;
      message: string;
    }
  | {
      kind: "reset_after_chunk";
      chunkCount: number;
      code: string;
      message: string;
    }
  | {
      kind: "stall_completion_after_close";
    }
  | {
      kind: "stall_progress_after_chunk";
      chunkCount: number;
    };

function createUploadServerBehavior(behavior?: UploadServerBehavior): UploadServerBehavior {
  return (
    behavior ?? {
      kind: "accept",
    }
  );
}

function createImageFile(input?: { bytes?: Uint8Array; name?: string }): File {
  const rawBytes = input?.bytes ?? new Uint8Array([1, 2, 3, 4]);
  const fileBytes = new Uint8Array(rawBytes.byteLength);
  fileBytes.set(rawBytes);

  return new File([fileBytes], input?.name ?? "screenshot.png", {
    type: "image/png",
  });
}

function createUploadRequest(input: { connectionUrl: string; file: File }) {
  return {
    connectionUrl: input.connectionUrl,
    file: input.file,
    runtime: createBrowserSandboxSessionRuntime(),
    threadId: "thread_123",
  } as const;
}

function sendControlMessage(socket: WebSocket, message: object): void {
  socket.send(JSON.stringify(message));
}

function sendStreamOpenResponse(
  socket: WebSocket,
  input:
    | {
        kind: "ok";
        streamId: number;
      }
    | {
        kind: "error";
        code: string;
        message: string;
        streamId: number;
      },
): void {
  if (input.kind === "ok") {
    sendControlMessage(socket, {
      type: "stream.open.ok",
      streamId: input.streamId,
    });
    return;
  }

  sendControlMessage(socket, {
    type: "stream.open.error",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
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
      path: "/tmp/attachments/thread_123/upload.png",
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
        if (behavior.kind === "close_after_open") {
          socket.close();
          return;
        }
        sendStreamOpenResponse(
          socket,
          behavior.kind === "reject_open"
            ? {
                kind: "error",
                streamId,
                code: behavior.code,
                message: behavior.message,
              }
            : {
                kind: "ok",
                streamId,
              },
        );
        return;
      }

      if (controlMessage?.type === "stream.close" && streamId !== null) {
        if (behavior.kind === "stall_completion_after_close") {
          return;
        }
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
        if (behavior.kind === "event_without_complete") {
          return;
        }
        sendStreamComplete(socket, streamId);
        return;
      }

      const dataFrame = decodeDataFrame(toUint8Array(message));
      if (dataFrame.payloadKind !== PayloadKindRawBytes) {
        throw new Error("Expected raw bytes payload kind.");
      }

      receivedChunks.push(dataFrame.payload);
      if (streamId !== null) {
        if (
          behavior.kind === "reset_after_chunk" &&
          receivedChunks.length === behavior.chunkCount
        ) {
          sendStreamReset(socket, {
            streamId,
            code: behavior.code,
            message: behavior.message,
          });
          return;
        }
        if (
          behavior.kind === "stall_progress_after_chunk" &&
          receivedChunks.length >= behavior.chunkCount
        ) {
          return;
        }
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

const openServers = new Set<TestUploadServer>();

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("uploadSandboxImage", () => {
  it("uploads file bytes and resolves with the completed upload result", async () => {
    const server = await startUploadTestServer();
    openServers.add(server);
    const file = createImageFile();

    const uploaded = await uploadSandboxImage(
      createUploadRequest({ connectionUrl: server.url, file }),
    );

    expect(Array.from(server.receivedBytes())).toEqual([1, 2, 3, 4]);
    expect(uploaded).toEqual({
      attachmentId: "att_123",
      threadId: "thread_123",
      originalFilename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 4,
      path: "/tmp/attachments/thread_123/upload.png",
    });
  });

  it("rejects when the upload stream open is rejected", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "reject_open",
        code: "unsupported_mime_type",
        message: "unsupported",
      },
    });
    openServers.add(server);
    const file = createImageFile();

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toThrow("unsupported");
  });

  it("preserves reset codes when the runtime rejects the uploaded image", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "reset_after_close",
        code: FileUploadResetCodes.INVALID_FILE_TYPE,
        message: "Uploaded file is not a supported image.",
      },
    });
    openServers.add(server);
    const file = createImageFile();

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toMatchObject({
      name: "FileUploadRejectedError",
      code: FileUploadResetCodes.INVALID_FILE_TYPE,
      message: "Uploaded file is not a supported image.",
    } satisfies Pick<FileUploadRejectedError, "code" | "message" | "name">);
  });

  it("rejects when the websocket closes before the upload stream opens", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "close_after_open",
      },
    });
    openServers.add(server);
    const file = createImageFile();

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toThrow("Sandbox websocket connection closed unexpectedly.");
  });

  it("stops uploading and preserves reset codes when the runtime resets during upload", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "reset_after_chunk",
        chunkCount: 1,
        code: FileUploadResetCodes.INVALID_IMAGE_CONTENT,
        message: "Uploaded image bytes were rejected during validation.",
      },
    });
    openServers.add(server);
    const file = createImageFile({
      bytes: new Uint8Array(64 * 1024 + 1),
    });

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toMatchObject({
      name: "FileUploadRejectedError",
      code: FileUploadResetCodes.INVALID_IMAGE_CONTENT,
      message: "Uploaded image bytes were rejected during validation.",
    } satisfies Pick<FileUploadRejectedError, "code" | "message" | "name">);

    expect(server.receivedBytes().byteLength).toBe(64 * 1024);
  });

  it("times out when upload progress stalls waiting for the next stream window", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "stall_progress_after_chunk",
        chunkCount: 1,
      },
    });
    openServers.add(server);
    const file = createImageFile({
      bytes: new Uint8Array(64 * 1024 + 1),
    });

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toThrow("Timed out while waiting for upload progress.");
  }, 20_000);

  it("times out when upload completion never arrives after closing the stream", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "event_without_complete",
      },
    });
    openServers.add(server);
    const file = createImageFile();

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toThrow("Timed out while waiting for upload completion.");
  }, 20_000);

  it("rejects when stream.complete arrives before fileUpload.completed", async () => {
    const server = await startUploadTestServer({
      behavior: {
        kind: "complete_without_event",
      },
    });
    openServers.add(server);
    const file = createImageFile();

    await expect(
      uploadSandboxImage(createUploadRequest({ connectionUrl: server.url, file })),
    ).rejects.toThrow("Received stream.complete before file upload completion event.");
  });
});
