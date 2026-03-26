import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";

import { createBrowserSandboxSessionRuntime } from "./browser.js";
import { uploadSandboxImage } from "./file-upload-client.js";

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

async function startUploadTestServer(input?: { rejectOpen?: boolean }): Promise<TestUploadServer> {
  const receivedChunks: Uint8Array[] = [];
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    let streamId: number | null = null;

    socket.on("message", (message) => {
      const controlMessage = parseStreamControlMessage(toText(message));
      if (controlMessage?.type === "stream.open") {
        streamId = controlMessage.streamId;
        socket.send(
          JSON.stringify(
            input?.rejectOpen
              ? {
                  type: "stream.open.error",
                  streamId,
                  code: "unsupported_mime_type",
                  message: "unsupported",
                }
              : {
                  type: "stream.open.ok",
                  streamId,
                },
          ),
        );
        return;
      }

      if (controlMessage?.type === "stream.close" && streamId !== null) {
        socket.send(
          JSON.stringify({
            type: "stream.event",
            streamId,
            event: {
              type: "fileUpload.completed",
              attachmentId: "att_123",
              threadId: "thread_123",
              originalFilename: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: receivedChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
              path: "/tmp/attachments/thread_123/upload.png",
            },
          }),
        );
        return;
      }

      const dataFrame = decodeDataFrame(toUint8Array(message));
      if (dataFrame.payloadKind !== PayloadKindRawBytes) {
        throw new Error("Expected raw bytes payload kind.");
      }

      receivedChunks.push(dataFrame.payload);
      if (streamId !== null) {
        socket.send(
          JSON.stringify({
            type: "stream.window",
            streamId,
            bytes: dataFrame.payload.byteLength,
          }),
        );
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    close: async () => {
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
    const file = new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", {
      type: "image/png",
    });

    const uploaded = await uploadSandboxImage({
      connectionUrl: server.url,
      file,
      runtime: createBrowserSandboxSessionRuntime(),
      threadId: "thread_123",
    });

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
    const server = await startUploadTestServer({ rejectOpen: true });
    openServers.add(server);
    const file = new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", {
      type: "image/png",
    });

    await expect(
      uploadSandboxImage({
        connectionUrl: server.url,
        file,
        runtime: createBrowserSandboxSessionRuntime(),
        threadId: "thread_123",
      }),
    ).rejects.toThrow("unsupported");
  });
});
