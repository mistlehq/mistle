import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { createNodeSandboxSessionRuntime } from "./node.js";
import { PtyStreamClient } from "./pty-stream-client.js";
import { SandboxPtyStates } from "./pty-types.js";
import { SandboxSessionTransport } from "./transport.js";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type TestServer = {
  close: () => Promise<void>;
  closeRequest: Promise<number>;
  openRequest: Promise<string>;
  payload: Promise<{ payload: string; streamId: number }>;
  sendExit: (input: { exitCode: number }) => void;
  sendReset: (input: { code: string; message: string }) => void;
  sendStdout: (payload: string) => void;
  url: string;
};

const PollIntervalMs = 10;
const openServers = new Set<TestServer>();

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
  };
}

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

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

async function startTestServer(): Promise<TestServer> {
  const openRequestDeferred = createDeferred<string>();
  const closeRequestDeferred = createDeferred<number>();
  const payloadDeferred = createDeferred<{ payload: string; streamId: number }>();

  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  let activeStreamId: number | null = null;
  let connectedSocket: NodeWebSocket | null = null;

  wsServer.on("connection", (socket) => {
    connectedSocket = socket;

    socket.on("message", (message) => {
      const controlMessage = parseStreamControlMessage(toText(message));
      if (controlMessage?.type === "stream.open") {
        activeStreamId = controlMessage.streamId;
        openRequestDeferred.resolve(JSON.stringify(controlMessage));
        socket.send(
          JSON.stringify({
            type: "stream.open.ok",
            streamId: controlMessage.streamId,
          }),
        );
        return;
      }

      if (controlMessage?.type === "stream.close") {
        closeRequestDeferred.resolve(controlMessage.streamId);
        return;
      }

      if (controlMessage !== undefined) {
        return;
      }

      try {
        const frame = decodeDataFrame(toUint8Array(message));
        payloadDeferred.resolve({
          payload: new TextDecoder().decode(frame.payload),
          streamId: frame.streamId,
        });
      } catch (error) {
        payloadDeferred.reject(error);
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    close: async () => {
      connectedSocket?.close();
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
    closeRequest: closeRequestDeferred.promise,
    openRequest: openRequestDeferred.promise,
    payload: payloadDeferred.promise,
    sendExit: (input) => {
      if (connectedSocket === null || activeStreamId === null) {
        throw new Error("Expected PTY stream to be open before sending exit.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.event",
          streamId: activeStreamId,
          event: {
            type: "pty.exit",
            exitCode: input.exitCode,
          },
        }),
      );
      connectedSocket.send(
        JSON.stringify({
          type: "stream.complete",
          streamId: activeStreamId,
        }),
      );
    },
    sendReset: (input) => {
      if (connectedSocket === null || activeStreamId === null) {
        throw new Error("Expected PTY stream to be open before sending reset.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.reset",
          streamId: activeStreamId,
          code: input.code,
          message: input.message,
        }),
      );
    },
    sendStdout: (payload) => {
      if (connectedSocket === null || activeStreamId === null) {
        throw new Error("Expected PTY stream to be open before sending stdout.");
      }

      connectedSocket.send(
        encodeDataFrame({
          streamId: activeStreamId,
          payloadKind: PayloadKindRawBytes,
          payload: new TextEncoder().encode(payload),
        }),
      );
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

async function createConnectedClient(server: TestServer): Promise<PtyStreamClient> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  await transport.connect({
    connectionUrl: server.url,
  });
  const client = new PtyStreamClient({
    transport,
  });
  await client.connect();
  return client;
}

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("PtyStreamClient", () => {
  it("opens a PTY stream over the shared transport and forwards data", async () => {
    const server = await startTestServer();
    openServers.add(server);
    const client = await createConnectedClient(server);
    const receivedChunks: string[] = [];

    client.onData((chunk) => {
      receivedChunks.push(new TextDecoder().decode(chunk));
    });

    await client.open({
      ptySessionId: "terminal",
      cols: 80,
      rows: 24,
      command: "/bin/sh",
      args: ["-lc", "echo hi"],
    });

    expect(JSON.parse(await server.openRequest)).toMatchObject({
      type: "stream.open",
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 80,
        rows: 24,
        command: "/bin/sh",
        args: ["-lc", "echo hi"],
      },
    });

    server.sendStdout("hello from pty");

    await waitForCondition({
      description: "PTY data event",
      evaluate: () => receivedChunks.includes("hello from pty"),
      timeoutMs: 500,
    });

    expect(client.state).toBe(SandboxPtyStates.OPEN);
  });

  it("sends raw bytes over the active PTY stream", async () => {
    const server = await startTestServer();
    openServers.add(server);
    const client = await createConnectedClient(server);

    await client.open({
      ptySessionId: "terminal",
      cols: 80,
      rows: 24,
    });

    await client.write("ls -la\n");

    expect(await server.payload).toEqual({
      payload: "ls -la\n",
      streamId: 1,
    });
  });

  it("keeps the shared transport alive when the PTY stream resets", async () => {
    const server = await startTestServer();
    openServers.add(server);
    const client = await createConnectedClient(server);

    await client.open({
      ptySessionId: "terminal",
      cols: 80,
      rows: 24,
    });

    server.sendReset({
      code: "bootstrap_disconnected",
      message: "Sandbox bootstrap tunnel disconnected.",
    });

    await waitForCondition({
      description: "PTY reset state",
      evaluate: () =>
        client.state === SandboxPtyStates.CONNECTED &&
        client.resetInfo?.code === "bootstrap_disconnected",
      timeoutMs: 500,
    });

    expect(client.streamId).toBeNull();
    expect(client.resetInfo).toEqual({
      code: "bootstrap_disconnected",
      message: "Sandbox bootstrap tunnel disconnected.",
    });
  });
});
