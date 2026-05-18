import { systemClock, systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";

import { createNodeSandboxSessionRuntime } from "./node.js";
import { PtyTransportClient } from "./pty-transport-client.js";
import { SandboxPtyStates } from "./pty-types.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestServer = {
  close: () => Promise<void>;
  closeRequest: Promise<unknown>;
  openRequest: Promise<unknown>;
  receivedInput: Promise<Uint8Array>;
  resizeRequest: Promise<unknown>;
  sendOutput: (payload: string) => void;
  url: string;
};

const servers: TestServer[] = [];

afterEach(async () => {
  const pendingServers = servers.splice(0);
  await Promise.all(pendingServers.map((server) => server.close()));
});

describe("PtyTransportClient", () => {
  it("opens direct PTY transport and exchanges raw terminal frames", async () => {
    const server = await startTestServer();
    servers.push(server);
    const client = new PtyTransportClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });
    const states: string[] = [];
    const outputChunks: string[] = [];
    client.onState((state) => {
      states.push(state);
    });
    client.onData((chunk) => {
      outputChunks.push(new TextDecoder().decode(chunk));
    });

    await client.open({
      ptySessionId: "terminal",
      cols: 100,
      rows: 30,
      cwd: "/workspace",
      command: "bash",
      args: ["-l"],
    });

    await expect(server.openRequest).resolves.toEqual({
      type: "pty.transport.open",
      launch: {
        session: "create",
        cols: 100,
        rows: 30,
        cwd: "/workspace",
        command: "bash",
        args: ["-l"],
      },
    });
    expect(client.state).toBe(SandboxPtyStates.OPEN);

    server.sendOutput("hello from pty");
    await waitFor(() => outputChunks.includes("hello from pty"));

    await client.write("echo hello\n");
    await expect(server.receivedInput).resolves.toEqual(new TextEncoder().encode("echo hello\n"));

    await client.resize({ cols: 120, rows: 40 });
    await expect(server.resizeRequest).resolves.toEqual({
      type: "stream.signal",
      streamId: 1,
      signal: {
        type: "pty.resize",
        cols: 120,
        rows: 40,
      },
    });

    await client.close();
    await expect(server.closeRequest).resolves.toEqual({
      type: "stream.close",
      streamId: 1,
    });
    expect(states).toContain(SandboxPtyStates.CONNECTING);
    expect(states).toContain(SandboxPtyStates.OPEN);
  });
});

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
  };
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

async function startTestServer(): Promise<TestServer> {
  const openRequest = createDeferred<unknown>();
  const receivedInput = createDeferred<Uint8Array>();
  const resizeRequest = createDeferred<unknown>();
  const closeRequest = createDeferred<unknown>();
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  let connectedSocket: WebSocket | null = null;
  wsServer.on("connection", (socket) => {
    connectedSocket = socket;
    socket.on("message", (message, isBinary) => {
      if (isBinary) {
        receivedInput.resolve(toUint8Array(message));
        return;
      }

      const parsedMessage = JSON.parse(new TextDecoder().decode(toUint8Array(message)));
      if (
        typeof parsedMessage === "object" &&
        parsedMessage !== null &&
        "type" in parsedMessage &&
        parsedMessage.type === "pty.transport.open"
      ) {
        openRequest.resolve(parsedMessage);
        return;
      }
      if (
        typeof parsedMessage === "object" &&
        parsedMessage !== null &&
        "type" in parsedMessage &&
        parsedMessage.type === "stream.signal"
      ) {
        resizeRequest.resolve(parsedMessage);
        return;
      }
      if (
        typeof parsedMessage === "object" &&
        parsedMessage !== null &&
        "type" in parsedMessage &&
        parsedMessage.type === "stream.close"
      ) {
        closeRequest.resolve(parsedMessage);
      }
    });
    socket.on("error", (error) => {
      openRequest.reject(error);
      receivedInput.reject(error);
      resizeRequest.reject(error);
      closeRequest.reject(error);
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
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
      });
    },
    closeRequest: closeRequest.promise,
    openRequest: openRequest.promise,
    receivedInput: receivedInput.promise,
    resizeRequest: resizeRequest.promise,
    sendOutput: (payload) => {
      if (connectedSocket === null || connectedSocket.readyState !== WebSocket.OPEN) {
        throw new Error("Expected direct PTY transport socket to be connected.");
      }
      connectedSocket.send(new TextEncoder().encode(payload));
    },
    url: `ws://127.0.0.1:${String(address.port)}/_mistle/pty/connect`,
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = systemClock.nowMs() + 1_000;
  while (systemClock.nowMs() < deadline) {
    if (assertion()) {
      return;
    }
    await systemSleeper.sleep(10);
  }

  throw new Error("Timed out waiting for PTY transport client assertion.");
}
