import { createServer as createNetServer, type Socket as NetSocket } from "node:net";

import {
  decodeDataFrame,
  DefaultStreamWindowBytes,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";

import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxPtyClient } from "./pty-client.js";
import { SandboxPtyStates } from "./pty-types.js";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type ReceivedControlMessage = {
  kind: "control";
  message: StreamControlMessage;
};

type ReceivedDataFrame = {
  kind: "data";
  payload: Uint8Array;
  payloadKind: number;
  streamId: number;
};

type ReceivedServerMessage = ReceivedControlMessage | ReceivedDataFrame;

type Waiter = {
  reject: (reason: unknown) => void;
  resolve: (message: ReceivedServerMessage) => void;
};

type PtyTestServer = {
  close: () => Promise<void>;
  closeClientSocket: () => void;
  sendMalformedDataFrame: (streamId: number) => void;
  sendOpenError: (input: { code: string; message: string; streamId: number }) => void;
  sendOpenOk: (streamId: number) => void;
  sendPtyExit: (input: { exitCode: number; streamId: number }) => void;
  sendPtyOutput: (input: { payload: Uint8Array; streamId: number }) => void;
  sendReset: (input: { code: string; message: string; streamId: number }) => void;
  sendWindowUpdate: (input: { bytes: number; streamId: number }) => void;
  url: string;
  waitForNextMessage: () => Promise<ReceivedServerMessage>;
};

type HangingTcpServer = {
  close: () => Promise<void>;
  url: string;
};

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
        throw new Error("Deferred reject was not initialized.");
      }

      rejectFn(reason);
    },
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve was not initialized.");
      }

      resolveFn(value);
    },
  };
}

async function waitForEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
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

function toText(data: RawData): string {
  return new TextDecoder().decode(toUint8Array(data));
}

async function startPtyTestServer(): Promise<PtyTestServer> {
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  let connectedSocket: import("ws").WebSocket | null = null;
  const queuedMessages: ReceivedServerMessage[] = [];
  const waiters: Waiter[] = [];

  const dispatchMessage = (message: ReceivedServerMessage): void => {
    const waiter = waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(message);
      return;
    }

    queuedMessages.push(message);
  };

  wsServer.on("connection", (socket) => {
    connectedSocket = socket;

    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(data));
        if (controlMessage === undefined) {
          const waiter = waiters.shift();
          if (waiter !== undefined) {
            waiter.reject(new Error("Expected a valid PTY control message."));
          }
          return;
        }

        dispatchMessage({
          kind: "control",
          message: controlMessage,
        });
        return;
      }

      const dataFrame = decodeDataFrame(toUint8Array(data));
      dispatchMessage({
        kind: "data",
        payload: dataFrame.payload,
        payloadKind: dataFrame.payloadKind,
        streamId: dataFrame.streamId,
      });
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a socket address.");
  }

  return {
    close: async () => {
      if (connectedSocket !== null) {
        connectedSocket.close();
      }

      for (const waiter of waiters) {
        waiter.reject(new Error("PTY test server closed before the next message arrived."));
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
    closeClientSocket: () => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before closing.");
      }

      connectedSocket.close();
    },
    sendMalformedDataFrame: (streamId) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending data.");
      }

      connectedSocket.send(
        encodeDataFrame({
          streamId,
          payloadKind: PayloadKindWebSocketText,
          payload: new TextEncoder().encode("invalid-pty-payload-kind"),
        }),
      );
    },
    sendOpenError: ({ code, message, streamId }) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending control.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.open.error",
          streamId,
          code,
          message,
        }),
      );
    },
    sendOpenOk: (streamId) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending control.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.open.ok",
          streamId,
        }),
      );
    },
    sendPtyExit: ({ exitCode, streamId }) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending control.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.event",
          streamId,
          event: {
            type: "pty.exit",
            exitCode,
          },
        }),
      );
    },
    sendPtyOutput: ({ payload, streamId }) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending data.");
      }

      connectedSocket.send(
        encodeDataFrame({
          streamId,
          payloadKind: PayloadKindRawBytes,
          payload,
        }),
      );
    },
    sendReset: ({ code, message, streamId }) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending control.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.reset",
          streamId,
          code,
          message,
        }),
      );
    },
    sendWindowUpdate: ({ bytes, streamId }) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending control.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.window",
          streamId,
          bytes,
        }),
      );
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
    waitForNextMessage: async () => {
      const queuedMessage = queuedMessages.shift();
      if (queuedMessage !== undefined) {
        return queuedMessage;
      }

      const deferred = createDeferred<ReceivedServerMessage>();
      waiters.push({
        reject: deferred.reject,
        resolve: deferred.resolve,
      });
      return deferred.promise;
    },
  };
}

const startedServers: PtyTestServer[] = [];
const startedNetServers: HangingTcpServer[] = [];

afterEach(async () => {
  while (startedServers.length > 0) {
    const server = startedServers.pop();
    if (server !== undefined) {
      await server.close();
    }
  }

  while (startedNetServers.length > 0) {
    const server = startedNetServers.pop();
    if (server !== undefined) {
      await server.close();
    }
  }
});

async function startHangingTcpServer(): Promise<HangingTcpServer> {
  const sockets = new Set<NetSocket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (error) => reject(error));
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected TCP server to expose a socket address.");
  }

  return {
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

describe("SandboxPtyClient", () => {
  it("connects and opens a PTY stream successfully", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 120,
      rows: 40,
      cwd: "/workspace",
    });

    const openRequest = await server.waitForNextMessage();
    expect(openRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.open",
        streamId: 1,
        channel: {
          kind: "pty",
          session: "create",
          cols: 120,
          rows: 40,
          cwd: "/workspace",
        },
      },
    });

    server.sendOpenOk(1);
    await openPromise;

    expect(client.state).toBe(SandboxPtyStates.OPEN);
    expect(client.streamId).toBe(1);
  });

  it("forwards PTY output bytes and acknowledges the receive window", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });
    const receivedChunks: Uint8Array[] = [];
    client.onData((chunk) => {
      receivedChunks.push(chunk);
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    const payload = new TextEncoder().encode("echo from pty");
    server.sendPtyOutput({
      payload,
      streamId: 1,
    });

    const windowUpdate = await server.waitForNextMessage();
    expect(receivedChunks).toEqual([payload]);
    expect(windowUpdate).toEqual({
      kind: "control",
      message: {
        type: "stream.window",
        streamId: 1,
        bytes: payload.byteLength,
      },
    });
  });

  it("surfaces stream.open.error responses", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenError({
      code: "pty_unavailable",
      message: "pty unavailable",
      streamId: 1,
    });

    await expect(openPromise).rejects.toThrowError("pty unavailable");
    expect(client.state).toBe(SandboxPtyStates.CONNECTED);
    expect(client.error?.message).toBe("pty unavailable");
  });

  it("can retry open on the same websocket after stream.open.error", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const firstOpenPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenError({
      code: "bootstrap_not_connected",
      message: "bootstrap unavailable",
      streamId: 1,
    });

    await expect(firstOpenPromise).rejects.toThrowError("bootstrap unavailable");
    expect(client.state).toBe(SandboxPtyStates.CONNECTED);

    const secondOpenPromise = client.open({
      cols: 100,
      rows: 30,
    });
    const secondOpenRequest = await server.waitForNextMessage();
    expect(secondOpenRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.open",
        streamId: 2,
        channel: {
          kind: "pty",
          session: "create",
          cols: 100,
          rows: 30,
        },
      },
    });
    server.sendOpenOk(2);
    await secondOpenPromise;

    expect(client.state).toBe(SandboxPtyStates.OPEN);
    expect(client.streamId).toBe(2);
  });

  it("fails open immediately when the server resets the PTY stream", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });
    const resets: Array<{ code: string; message: string }> = [];
    client.onReset((resetInfo) => {
      resets.push(resetInfo);
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendReset({
      code: "invalid_stream_data",
      message: "stream setup invalidated before open completed",
      streamId: 1,
    });

    await expect(openPromise).rejects.toThrowError(
      "Sandbox PTY stream reset (invalid_stream_data): stream setup invalidated before open completed",
    );
    expect(client.state).toBe(SandboxPtyStates.CONNECTED);
    expect(client.resetInfo).toEqual({
      code: "invalid_stream_data",
      message: "stream setup invalidated before open completed",
    });
    expect(resets).toEqual([
      {
        code: "invalid_stream_data",
        message: "stream setup invalidated before open completed",
      },
    ]);
  });

  it("rejects resize before the PTY stream is open", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();

    await expect(
      client.resize({
        cols: 120,
        rows: 40,
      }),
    ).rejects.toThrowError("Sandbox PTY stream is not open.");
  });

  it("sends PTY resize signals for the active stream", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    await client.resize({
      cols: 132,
      rows: 48,
    });

    const resizeRequest = await server.waitForNextMessage();
    expect(resizeRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.signal",
        streamId: 1,
        signal: {
          type: "pty.resize",
          cols: 132,
          rows: 48,
        },
      },
    });
  });

  it("returns to the connected state after receiving pty.exit for close", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    const closePromise = client.close();
    expect(client.state).toBe(SandboxPtyStates.CLOSING);

    const closeRequest = await server.waitForNextMessage();
    expect(closeRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.close",
        streamId: 1,
      },
    });
    server.sendPtyExit({
      exitCode: 0,
      streamId: 1,
    });
    await closePromise;

    expect(client.state).toBe(SandboxPtyStates.CONNECTED);
    expect(client.streamId).toBeNull();
    expect(client.exitInfo).toEqual({
      exitCode: 0,
    });
  });

  it("rejects close on timeout and keeps waiting for terminal completion", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      closeTimeoutMs: 5,
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    const closePromise = client.close();
    const closeRequest = await server.waitForNextMessage();
    expect(closeRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.close",
        streamId: 1,
      },
    });
    await expect(closePromise).rejects.toThrowError(
      "Timed out while waiting for sandbox PTY close confirmation.",
    );

    expect(client.state).toBe(SandboxPtyStates.CLOSING);
    expect(client.streamId).toBe(1);

    server.sendPtyExit({
      exitCode: 0,
      streamId: 1,
    });
    await waitForEventLoopTurn();

    expect(client.state).toBe(SandboxPtyStates.CONNECTED);
    expect(client.streamId).toBeNull();
  });

  it("rejects close when the websocket drops before pty.exit arrives", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    const closePromise = client.close();
    await server.waitForNextMessage();
    server.closeClientSocket();

    await expect(closePromise).rejects.toThrowError(
      "Sandbox PTY websocket closed before close confirmation was received.",
    );
    await client.disconnect();

    expect(client.state).toBe(SandboxPtyStates.ERROR);
    expect(client.streamId).toBeNull();
  });

  it("rejects close when the runtime reports stream_close_failed", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    const closePromise = client.close();
    await server.waitForNextMessage();
    server.sendReset({
      code: "stream_close_failed",
      message: "failed to terminate pty session",
      streamId: 1,
    });

    await expect(closePromise).rejects.toThrowError(
      "Sandbox PTY stream reset (stream_close_failed): failed to terminate pty session",
    );
    expect(client.state).toBe(SandboxPtyStates.ERROR);
    expect(client.resetInfo).toEqual({
      code: "stream_close_failed",
      message: "failed to terminate pty session",
    });
  });

  it("can reopen a PTY on the same websocket after stream.close", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const firstOpenPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await firstOpenPromise;

    const firstClosePromise = client.close();
    await server.waitForNextMessage();
    server.sendPtyExit({
      exitCode: 0,
      streamId: 1,
    });
    await firstClosePromise;

    const secondOpenPromise = client.open({
      cols: 132,
      rows: 48,
    });
    const secondOpenRequest = await server.waitForNextMessage();
    expect(secondOpenRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.open",
        streamId: 2,
        channel: {
          kind: "pty",
          session: "create",
          cols: 132,
          rows: 48,
        },
      },
    });
    server.sendOpenOk(2);
    await secondOpenPromise;

    expect(client.state).toBe(SandboxPtyStates.OPEN);
    expect(client.streamId).toBe(2);
  });

  it("returns to the connected state after an unsolicited pty.exit", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const firstOpenPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await firstOpenPromise;

    server.sendPtyExit({
      exitCode: 0,
      streamId: 1,
    });
    await waitForEventLoopTurn();

    expect(client.state).toBe(SandboxPtyStates.CONNECTED);
    expect(client.streamId).toBeNull();
    expect(client.exitInfo).toEqual({
      exitCode: 0,
    });

    const secondOpenPromise = client.open({
      cols: 100,
      rows: 30,
    });
    const secondOpenRequest = await server.waitForNextMessage();
    expect(secondOpenRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.open",
        streamId: 2,
        channel: {
          kind: "pty",
          session: "create",
          cols: 100,
          rows: 30,
        },
      },
    });
    server.sendOpenOk(2);
    await secondOpenPromise;

    expect(client.state).toBe(SandboxPtyStates.OPEN);
    expect(client.streamId).toBe(2);
  });

  it("surfaces stream.reset as an error and preserves reset details", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });
    const resets: Array<{ code: string; message: string }> = [];
    const resetDeferred = createDeferred<void>();
    client.onReset((resetInfo) => {
      resets.push(resetInfo);
      resetDeferred.resolve();
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    server.sendReset({
      code: "bootstrap_reconnected",
      message: "Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream.",
      streamId: 1,
    });
    await resetDeferred.promise;

    expect(client.state).toBe(SandboxPtyStates.CONNECTED);
    expect(client.error?.message).toBe(
      "Sandbox PTY stream reset (bootstrap_reconnected): Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream.",
    );
    expect(client.resetInfo).toEqual({
      code: "bootstrap_reconnected",
      message: "Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream.",
    });
    expect(resets).toEqual([
      {
        code: "bootstrap_reconnected",
        message: "Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream.",
      },
    ]);
    await expect(client.write("pwd\n")).rejects.toThrowError("Sandbox PTY stream is not open.");
  });

  it("can reopen after stream.reset on the same websocket", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const firstOpenPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await firstOpenPromise;

    server.sendReset({
      code: "bootstrap_reconnected",
      message: "Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream.",
      streamId: 1,
    });
    await waitForEventLoopTurn();

    expect(client.state).toBe(SandboxPtyStates.CONNECTED);

    const secondOpenPromise = client.open({
      cols: 110,
      rows: 35,
    });
    const secondOpenRequest = await server.waitForNextMessage();
    expect(secondOpenRequest).toEqual({
      kind: "control",
      message: {
        type: "stream.open",
        streamId: 2,
        channel: {
          kind: "pty",
          session: "create",
          cols: 110,
          rows: 35,
        },
      },
    });
    server.sendOpenOk(2);
    await secondOpenPromise;

    expect(client.state).toBe(SandboxPtyStates.OPEN);
    expect(client.streamId).toBe(2);
  });

  it("maintains the PTY send window", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    const firstPayload = new Uint8Array(DefaultStreamWindowBytes);
    await client.write(firstPayload);
    const firstWrite = await server.waitForNextMessage();
    expect(firstWrite).toEqual({
      kind: "data",
      streamId: 1,
      payloadKind: PayloadKindRawBytes,
      payload: firstPayload,
    });

    await expect(client.write(new Uint8Array([1]))).rejects.toThrowError(
      "Sandbox PTY stream send window is exhausted.",
    );

    server.sendWindowUpdate({
      bytes: 1,
      streamId: 1,
    });
    await waitForEventLoopTurn();
    await waitForEventLoopTurn();
    await client.write(new Uint8Array([7]));

    const secondWrite = await server.waitForNextMessage();
    expect(secondWrite).toEqual({
      kind: "data",
      streamId: 1,
      payloadKind: PayloadKindRawBytes,
      payload: new Uint8Array([7]),
    });
  });

  it("treats transport close after open as closed rather than exited", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });
    const exits: Array<{ exitCode: number }> = [];
    client.onExit((exitInfo) => {
      exits.push(exitInfo);
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    server.closeClientSocket();

    await client.disconnect();

    expect(client.state).toBe(SandboxPtyStates.CLOSED);
    expect(client.exitInfo).toBeNull();
    expect(exits).toEqual([]);
  });

  it("allows disconnect during connect without hanging", async () => {
    const server = await startHangingTcpServer();
    startedNetServers.push(server);
    const client = new SandboxPtyClient({
      connectTimeoutMs: 5_000,
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    const connectPromise = client.connect();
    await waitForEventLoopTurn();

    await client.disconnect();

    await expect(connectPromise).rejects.toThrowError(
      /Sandbox PTY websocket connection (failed|closed before becoming ready)\./u,
    );
    expect(client.state).toBe(SandboxPtyStates.CLOSED);
  });

  it("surfaces malformed active-stream payloads as protocol errors", async () => {
    const server = await startPtyTestServer();
    startedServers.push(server);
    const client = new SandboxPtyClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });
    const errorDeferred = createDeferred<Error>();
    client.onError((error) => {
      errorDeferred.resolve(error);
    });

    await client.connect();
    const openPromise = client.open({
      cols: 80,
      rows: 24,
    });
    await server.waitForNextMessage();
    server.sendOpenOk(1);
    await openPromise;

    server.sendMalformedDataFrame(1);
    const protocolError = await errorDeferred.promise;

    expect(client.state).toBe(SandboxPtyStates.ERROR);
    expect(protocolError.message).toBe(
      "Sandbox PTY stream received an unsupported data payload kind.",
    );
    expect(client.error?.message).toBe(
      "Sandbox PTY stream received an unsupported data payload kind.",
    );
  });
});
