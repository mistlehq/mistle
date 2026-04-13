import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { ExecStreamClient } from "./exec-stream-client.js";
import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxSessionTransport } from "./transport.js";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type TestServer = {
  close: () => Promise<void>;
  openRequest: Promise<string>;
  sendReset: (input: { code: string; message: string }) => void;
  sendResult: (input: {
    exitCode: number;
    stderr: string;
    stdout: string;
    truncated: boolean;
  }) => void;
  url: string;
};

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

async function startTestServer(): Promise<TestServer> {
  const openRequestDeferred = createDeferred<string>();
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
      const payload = JSON.parse(toText(message)) as { streamId?: number; type?: string };
      if (payload.type !== "stream.open" || typeof payload.streamId !== "number") {
        return;
      }

      activeStreamId = payload.streamId;
      openRequestDeferred.resolve(JSON.stringify(payload));
      socket.send(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: payload.streamId,
        }),
      );
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
    openRequest: openRequestDeferred.promise,
    sendReset: (input) => {
      if (connectedSocket === null || activeStreamId === null) {
        throw new Error("Expected exec stream to be open before sending reset.");
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
    sendResult: (input) => {
      if (connectedSocket === null || activeStreamId === null) {
        throw new Error("Expected exec stream to be open before sending result.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.event",
          streamId: activeStreamId,
          event: {
            type: "exec.result",
            exitCode: input.exitCode,
            stdout: input.stdout,
            stderr: input.stderr,
            truncated: input.truncated,
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
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

async function createConnectedClient(server: TestServer): Promise<{
  client: ExecStreamClient;
  transport: SandboxSessionTransport;
}> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  await transport.connect({
    connectionUrl: server.url,
  });
  return {
    client: new ExecStreamClient({
      transport,
    }),
    transport,
  };
}

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("ExecStreamClient", () => {
  it("opens an exec stream and resolves the command result after completion", async () => {
    const server = await startTestServer();
    openServers.add(server);
    const { client, transport } = await createConnectedClient(server);

    try {
      const resultPromise = client.run({
        command: "git",
        args: ["status", "--short"],
        cwd: "/workspace/repo",
        timeoutMs: 1000,
        maxOutputBytes: 4096,
      });

      expect(await server.openRequest).toContain('"kind":"exec"');
      await systemSleeper.sleep(20);
      server.sendResult({
        exitCode: 0,
        stdout: "M apps/dashboard/src/features/pages/session-workbench-page.tsx\n",
        stderr: "",
        truncated: false,
      });

      await expect(resultPromise).resolves.toEqual({
        exitCode: 0,
        stdout: "M apps/dashboard/src/features/pages/session-workbench-page.tsx\n",
        stderr: "",
        truncated: false,
      });
    } finally {
      transport.disconnect(1000, "test complete");
    }
  });

  it("rejects when the exec stream resets before a result arrives", async () => {
    const server = await startTestServer();
    openServers.add(server);
    const { client, transport } = await createConnectedClient(server);

    try {
      const resultPromise = client.run({
        command: "git",
      });

      await server.openRequest;
      await systemSleeper.sleep(20);

      server.sendReset({
        code: "target_closed",
        message: "exec stream failed",
      });

      await expect(resultPromise).rejects.toThrow(
        "Sandbox session stream reset (target_closed): exec stream failed",
      );
    } finally {
      transport.disconnect(1000, "test complete");
    }
  });

  it("handles an exec result that arrives before the stream listener finishes subscribing", async () => {
    const server = await startTestServer();
    openServers.add(server);
    const { client, transport } = await createConnectedClient(server);

    try {
      const resultPromise = client.run({
        command: "pwd",
      });

      await server.openRequest;
      server.sendResult({
        exitCode: 0,
        stdout: "/root/mistlehq/mistle\n",
        stderr: "",
        truncated: false,
      });

      await expect(resultPromise).resolves.toEqual({
        exitCode: 0,
        stdout: "/root/mistlehq/mistle\n",
        stderr: "",
        truncated: false,
      });
    } finally {
      transport.disconnect(1000, "test complete");
    }
  });
});
