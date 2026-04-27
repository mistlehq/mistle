import { createServer } from "node:http";

import { systemSleeper } from "@mistle/time";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { createInMemoryTunnelRelayCoordinator } from "../tunnel/create-in-memory-relay-coordinator.js";
import type { RelayPeerSocket, RelayTarget } from "../tunnel/types.js";
import {
  buildPortAccessRequestHeaders,
  buildPortAccessWebSocketRequestHeaders,
  PortAccessTransportService,
  toPortAccessResponseHeaders,
} from "./port-access-transport.js";

type ReceivedWebSocketMessage = {
  data: string | Buffer;
  isBinary: boolean;
};

type WebSocketPair = {
  clientSocket: WebSocket;
  serverSocket: WebSocket;
  peerSocket: RelayPeerSocket;
  closeAll: () => Promise<void>;
};

const LocalNodeId = "dpg_test";
const SandboxInstanceId = "sbi_port_access_transport";

const openWebSocketPairs: WebSocketPair[] = [];

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function waitForWebSocketMessage(socket: WebSocket): Promise<ReceivedWebSocketMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      resolve({
        data: isBinary ? toBuffer(data) : toBuffer(data).toString("utf8"),
        isBinary,
      });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

function waitForNoWebSocketMessage(socket: WebSocket, timeoutMs = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (): void => {
      cleanup();
      reject(new Error("Expected websocket to receive no message."));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);

    void systemSleeper.sleep(timeoutMs).then(() => {
      cleanup();
      resolve();
    });
  });
}

function toWsReadyState(input: number): 0 | 1 | 2 | 3 {
  if (input === 0 || input === 1 || input === 2 || input === 3) {
    return input;
  }

  throw new Error(`Unexpected websocket ready state: ${String(input)}`);
}

function toPeerSocket(socket: WebSocket): RelayPeerSocket {
  return new WSContext<WebSocket>({
    send: (data, options) => {
      socket.send(data, {
        compress: options.compress,
      });
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
    get readyState() {
      return toWsReadyState(socket.readyState);
    },
    raw: socket,
  });
}

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({
    server,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address to be available.");
  }

  const serverSocketPromise = new Promise<WebSocket>((resolve, reject) => {
    webSocketServer.once("connection", (socket) => {
      resolve(socket);
    });
    webSocketServer.once("error", reject);
  });
  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);

  await waitForWebSocketOpen(clientSocket);
  const serverSocket = await serverSocketPromise;

  return {
    clientSocket,
    serverSocket,
    peerSocket: toPeerSocket(serverSocket),
    closeAll: async () => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          clientSocket.once("close", () => {
            resolve();
          });
          clientSocket.close();
        });
      }

      if (serverSocket.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          serverSocket.once("close", () => {
            resolve();
          });
          serverSocket.close();
        });
      }

      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          server.close((serverError) => {
            if (serverError !== undefined) {
              reject(serverError);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}

function createBootstrapTarget(input: { sessionId: string }): RelayTarget {
  return {
    sandboxInstanceId: SandboxInstanceId,
    side: "bootstrap",
    nodeId: LocalNodeId,
    sessionId: input.sessionId,
  };
}

afterEach(async () => {
  while (openWebSocketPairs.length > 0) {
    await openWebSocketPairs.pop()?.closeAll();
  }
});

describe("port access transport helpers", () => {
  it("rewrites browser request headers for tunneled upstream delivery", () => {
    const requestHeaders = new Headers([
      ["accept", "text/html"],
      ["cookie", "mistle_port_access_session=session-token; theme=dark"],
      ["connection", "keep-alive"],
      ["host", "p-5173--sandbox.mistle.localhost"],
      ["origin", "https://p-5173--sandbox.mistle.localhost"],
      ["x-request-marker", "req-123"],
    ]);

    expect(
      buildPortAccessRequestHeaders({
        browserEdgePort: "443",
        browserEdgeProto: "https",
        browserVisibleHost: "p-5173--sandbox.mistle.localhost",
        requestHeaders,
        targetPort: 5173,
        upstreamProtocol: "http",
      }),
    ).toEqual({
      accept: ["text/html"],
      cookie: ["theme=dark"],
      host: ["127.0.0.1:5173"],
      origin: ["http://127.0.0.1:5173"],
      "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
      "x-forwarded-port": ["443"],
      "x-forwarded-proto": ["https"],
      "x-request-marker": ["req-123"],
    });
  });

  it("drops the cookie header when it only contains the port access session cookie", () => {
    const requestHeaders = new Headers([
      ["cookie", "mistle_port_access_session=session-token"],
      ["host", "p-5173--sandbox.mistle.localhost"],
    ]);

    expect(
      buildPortAccessRequestHeaders({
        browserEdgePort: "80",
        browserEdgeProto: "http",
        browserVisibleHost: "p-5173--sandbox.mistle.localhost",
        requestHeaders,
        targetPort: 5173,
        upstreamProtocol: "https",
      }),
    ).toEqual({
      host: ["127.0.0.1:5173"],
      "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
      "x-forwarded-port": ["80"],
      "x-forwarded-proto": ["http"],
    });
  });

  it("builds browser response headers from repeated tunneled header values", () => {
    const responseHeaders = toPortAccessResponseHeaders({
      "cache-control": ["no-store"],
      "set-cookie": ["a=1; Path=/", "b=2; Path=/"],
      vary: ["origin", "accept-encoding"],
    });

    expect(responseHeaders.get("cache-control")).toBe("no-store");
    expect(responseHeaders.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(responseHeaders.get("vary")).toBe("origin, accept-encoding");
  });

  it("rewrites browser websocket upgrade headers for tunneled upstream delivery", () => {
    const requestHeaders = new Headers([
      ["connection", "Upgrade"],
      ["cookie", "mistle_port_access_session=session-token; theme=dark"],
      ["host", "p-5173--sandbox.mistle.localhost"],
      ["origin", "https://dashboard.mistle.localhost"],
      ["sec-websocket-key", "websocket-key"],
      ["sec-websocket-version", "13"],
      ["upgrade", "websocket"],
    ]);

    expect(
      buildPortAccessWebSocketRequestHeaders({
        browserEdgePort: "443",
        browserEdgeProto: "https",
        browserVisibleHost: "p-5173--sandbox.mistle.localhost",
        requestHeaders,
        targetPort: 5173,
        upstreamProtocol: "http",
      }),
    ).toEqual({
      connection: ["Upgrade"],
      cookie: ["theme=dark"],
      host: ["127.0.0.1:5173"],
      origin: ["http://127.0.0.1:5173"],
      "sec-websocket-key": ["websocket-key"],
      "sec-websocket-version": ["13"],
      upgrade: ["websocket"],
      "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
      "x-forwarded-port": ["443"],
      "x-forwarded-proto": ["https"],
    });
  });

  it("drops websocket cookies entirely when only the port access session cookie is present", () => {
    const requestHeaders = new Headers([
      ["connection", "Upgrade"],
      ["cookie", "mistle_port_access_session=session-token"],
      ["upgrade", "websocket"],
    ]);

    expect(
      buildPortAccessWebSocketRequestHeaders({
        browserEdgePort: "80",
        browserEdgeProto: "http",
        browserVisibleHost: "p-5173--sandbox.mistle.localhost",
        requestHeaders,
        targetPort: 5173,
        upstreamProtocol: "https",
      }),
    ).toEqual({
      connection: ["Upgrade"],
      host: ["127.0.0.1:5173"],
      upgrade: ["websocket"],
      "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
      "x-forwarded-port": ["80"],
      "x-forwarded-proto": ["http"],
    });
  });
});

describe("port access transport session fencing", () => {
  it("does not send follow-up HTTP request body messages to a replacement bootstrap", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const service = new PortAccessTransportService(relayCoordinator);
    const firstBootstrap = await createWebSocketPair();
    const replacementBootstrap = await createWebSocketPair();
    openWebSocketPairs.push(firstBootstrap, replacementBootstrap);

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sessionId: "sess_bootstrap_a",
      }),
      socket: firstBootstrap.peerSocket,
    });

    const handle = await service.openHttpStream({
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
      request: {
        method: "POST",
        path: "/submit",
        headers: {},
      },
    });

    const openMessage = JSON.parse(
      String((await waitForWebSocketMessage(firstBootstrap.clientSocket)).data),
    );
    expect(openMessage).toEqual({
      type: "ports.http.open",
      streamId: 1,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
      request: {
        method: "POST",
        path: "/submit",
        headers: {},
      },
    });

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sessionId: "sess_bootstrap_b",
      }),
      socket: replacementBootstrap.peerSocket,
    });

    await handle.sendRequestBodyChunk(Uint8Array.from([1, 2, 3]));

    await waitForNoWebSocketMessage(replacementBootstrap.clientSocket);
  });

  it("ignores stale HTTP responses from the bootstrap session that no longer owns the stream", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const service = new PortAccessTransportService(relayCoordinator);
    const firstBootstrap = await createWebSocketPair();
    const replacementBootstrap = await createWebSocketPair();
    openWebSocketPairs.push(firstBootstrap, replacementBootstrap);

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sessionId: "sess_bootstrap_a",
      }),
      socket: firstBootstrap.peerSocket,
    });

    await service.openHttpStream({
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
      request: {
        method: "GET",
        path: "/",
        headers: {},
      },
    });

    await waitForWebSocketMessage(firstBootstrap.clientSocket);

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sessionId: "sess_bootstrap_b",
      }),
      socket: replacementBootstrap.peerSocket,
    });

    await expect(
      service.handleBootstrapTransportMessage({
        sandboxInstanceId: SandboxInstanceId,
        sourceBootstrapSessionId: "sess_bootstrap_a",
        message: {
          type: "ports.http.response.start",
          streamId: 1,
          status: 200,
          headers: {},
        },
      }),
    ).resolves.toBe(false);
  });

  it("does not reject replacement bootstrap streams when the old bootstrap closes", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const service = new PortAccessTransportService(relayCoordinator);
    const firstBootstrap = await createWebSocketPair();
    const replacementBootstrap = await createWebSocketPair();
    openWebSocketPairs.push(firstBootstrap, replacementBootstrap);

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sessionId: "sess_bootstrap_a",
      }),
      socket: firstBootstrap.peerSocket,
    });

    const oldHandle = await service.openHttpStream({
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
      request: {
        method: "GET",
        path: "/old",
        headers: {},
      },
    });
    await waitForWebSocketMessage(firstBootstrap.clientSocket);

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sessionId: "sess_bootstrap_b",
      }),
      socket: replacementBootstrap.peerSocket,
    });

    const replacementHandle = await service.openHttpStream({
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
      request: {
        method: "GET",
        path: "/new",
        headers: {},
      },
    });
    await waitForWebSocketMessage(replacementBootstrap.clientSocket);

    service.rejectPendingStreamsForBootstrapSession({
      sandboxInstanceId: SandboxInstanceId,
      targetBootstrapSessionId: "sess_bootstrap_a",
    });
    await expect(oldHandle.responseStart).rejects.toBeInstanceOf(Error);

    await replacementHandle.finishRequestBody();

    expect(
      JSON.parse(String((await waitForWebSocketMessage(replacementBootstrap.clientSocket)).data)),
    ).toEqual({
      type: "ports.http.body.end",
      streamId: 2,
      direction: "request",
    });
  });
});
