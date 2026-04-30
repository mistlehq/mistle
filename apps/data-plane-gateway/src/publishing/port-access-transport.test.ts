import { createServer } from "node:http";
import { createServer as createTcpServer, connect, type Socket } from "node:net";

import {
  decodeDataFrame,
  encodeDataFrame,
  MaxStreamWindowBytes,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { createInMemoryTunnelRelayCoordinator } from "../tunnel/create-in-memory-relay-coordinator.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type { RelayPeerSocket, RelayTarget } from "../tunnel/types.js";
import { PortAccessTransportService } from "./port-access-transport.js";

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

type WebSocketMessageQueue = {
  close: () => void;
  next: () => Promise<ReceivedWebSocketMessage>;
};

type TcpSocketPair = {
  clientSocket: Socket;
  gatewaySocket: Socket;
  closeAll: () => Promise<void>;
};

const LocalNodeId = "dpg_test";
const PortAccessSessionId = "pas_port_access_transport";
const SandboxInstanceId = "sbi_port_access_transport";

const openWebSocketPairs: WebSocketPair[] = [];
const openTcpSocketPairs: TcpSocketPair[] = [];

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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

function createWebSocketMessageQueue(socket: WebSocket): WebSocketMessageQueue {
  const queuedMessages: ReceivedWebSocketMessage[] = [];
  const waitingResolvers: Array<(message: ReceivedWebSocketMessage) => void> = [];
  const onMessage = (data: RawData, isBinary: boolean): void => {
    const message = {
      data: isBinary ? toBuffer(data) : toBuffer(data).toString("utf8"),
      isBinary,
    };
    const resolver = waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(message);
      return;
    }

    queuedMessages.push(message);
  };
  socket.on("message", onMessage);

  return {
    close: () => {
      socket.off("message", onMessage);
    },
    next: async () => {
      const message = queuedMessages.shift();
      if (message !== undefined) {
        return message;
      }

      return new Promise((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
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

function waitForTcpData(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer): void => {
      cleanup();
      resolve(data);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.once("data", onData);
    socket.once("error", onError);
    socket.resume();
  });
}

function waitForTcpEnd(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEnd = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("end", onEnd);
      socket.off("error", onError);
    };

    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.resume();
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

async function createTcpSocketPair(input?: { allowHalfOpen?: boolean }): Promise<TcpSocketPair> {
  const server = createTcpServer({
    allowHalfOpen: input?.allowHalfOpen ?? false,
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

  const gatewaySocketPromise = new Promise<Socket>((resolve) => {
    server.once("connection", (socket) => {
      resolve(socket);
    });
  });
  const clientSocket = connect({
    allowHalfOpen: input?.allowHalfOpen ?? false,
    host: "127.0.0.1",
    port: address.port,
  });
  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });
  const gatewaySocket = await gatewaySocketPromise;

  return {
    clientSocket,
    gatewaySocket,
    closeAll: async () => {
      const closePromises: Promise<void>[] = [];
      if (!clientSocket.destroyed) {
        closePromises.push(
          new Promise((resolve) => {
            clientSocket.once("close", () => {
              resolve();
            });
          }),
        );
      }
      if (!gatewaySocket.destroyed) {
        closePromises.push(
          new Promise((resolve) => {
            gatewaySocket.once("close", () => {
              resolve();
            });
          }),
        );
      }
      clientSocket.destroy();
      gatewaySocket.destroy();
      await Promise.all(closePromises);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
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

function createTunnelSessionRegistryWithBootstrap(input: {
  bootstrapTarget: RelayTarget;
}): TunnelSessionRegistry {
  const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
  registry.attachBootstrapSession(input.bootstrapTarget);
  return registry;
}

afterEach(async () => {
  while (openTcpSocketPairs.length > 0) {
    await openTcpSocketPairs.pop()?.closeAll();
  }
  while (openWebSocketPairs.length > 0) {
    await openWebSocketPairs.pop()?.closeAll();
  }
});

describe("port access transport session fencing", () => {
  it("allocates TCP stream IDs from the shared bootstrap session namespace", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_namespace",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const interactiveBinding = tunnelSessionRegistry.bindClientStream({
      sandboxInstanceId: SandboxInstanceId,
      channelKind: "pty",
      clientSessionId: "conn_interactive",
      clientStreamId: 1,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry);
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: Uint8Array.from([1, 2, 3]),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    void handle.connected.catch(() => undefined);
    const openMessage = JSON.parse(
      String((await waitForWebSocketMessage(bootstrap.clientSocket)).data),
    );

    expect(interactiveBinding.tunnelStreamId).toBe(1);
    expect(handle.streamId).toBe(2);
    expect(openMessage).toMatchObject({
      type: "ports.tcp.open",
      streamId: 2,
    });
  });

  it("waits for TCP connected before sending initial and client bytes as raw data frames", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_connected",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry);
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: Buffer.from("GET / HTTP/1.1\r\n\r\n"),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    const messageQueue = createWebSocketMessageQueue(bootstrap.clientSocket);
    await messageQueue.next();
    tcpPair.clientSocket.write("body");
    await waitForNoWebSocketMessage(bootstrap.clientSocket);

    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.connected",
        streamId: handle.streamId,
      },
    });
    await handle.connected;
    const initialFrame = decodeDataFrame(Buffer.from((await messageQueue.next()).data));
    const bodyFrame = decodeDataFrame(Buffer.from((await messageQueue.next()).data));
    messageQueue.close();

    expect(initialFrame).toMatchObject({
      payloadKind: PayloadKindRawBytes,
      streamId: handle.streamId,
    });
    expect(Buffer.from(initialFrame.payload).toString("utf8")).toBe("GET / HTTP/1.1\r\n\r\n");
    expect(bodyFrame).toMatchObject({
      payloadKind: PayloadKindRawBytes,
      streamId: handle.streamId,
    });
    expect(Buffer.from(bodyFrame.payload).toString("utf8")).toBe("body");
  });

  it("delivers bootstrap TCP raw data frames to the client and returns stream window credit", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_response",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry);
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    const messageQueue = createWebSocketMessageQueue(bootstrap.clientSocket);
    await messageQueue.next();
    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.connected",
        streamId: handle.streamId,
      },
    });
    await handle.connected;

    await expect(
      service.handleBootstrapDataFrame({
        payload: toArrayBuffer(
          encodeDataFrame({
            streamId: handle.streamId,
            payloadKind: PayloadKindRawBytes,
            payload: Buffer.from("HTTP/1.1 200 OK\r\n\r\n"),
          }),
        ),
        sandboxInstanceId: SandboxInstanceId,
        sourceBootstrapSessionId: bootstrapTarget.sessionId,
      }),
    ).resolves.toBe(true);

    expect((await waitForTcpData(tcpPair.clientSocket)).toString("utf8")).toBe(
      "HTTP/1.1 200 OK\r\n\r\n",
    );
    expect(JSON.parse(String((await messageQueue.next()).data))).toEqual({
      type: "stream.window",
      streamId: handle.streamId,
      bytes: "HTTP/1.1 200 OK\r\n\r\n".length,
    });
    messageQueue.close();
  });

  it("maps TCP connect errors to a client-visible socket failure and releases the stream", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_connect_error",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry);
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    await waitForWebSocketMessage(bootstrap.clientSocket);
    const connectedFailure = handle.connected.then(
      () => {
        throw new Error("Expected TCP connection to fail.");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
          throw new Error("Expected TCP connection failure to be an Error.");
        }
        expect(error.message).toContain("connection refused");
      },
    );
    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.error",
        streamId: handle.streamId,
        code: "upstream_connect_failed",
        message: "connection refused",
      },
    });
    await connectedFailure;

    const nextTcpPair = await createTcpSocketPair();
    openTcpSocketPairs.push(nextTcpPair);
    const nextHandle = await service.openTcpStream({
      client: nextTcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    void nextHandle.connected.catch(() => undefined);
    expect(nextHandle.streamId).toBe(2);
  });

  it("keeps TCP streams alive after sandboxd acknowledges request half-close", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_half_close",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry);
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair({
      allowHalfOpen: true,
    });
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    await waitForWebSocketMessage(bootstrap.clientSocket);
    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.connected",
        streamId: handle.streamId,
      },
    });
    tcpPair.clientSocket.end();

    expect(
      JSON.parse(String((await waitForWebSocketMessage(bootstrap.clientSocket)).data)),
    ).toEqual({
      type: "ports.tcp.close",
      streamId: handle.streamId,
      direction: "request",
    });

    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.close",
        streamId: handle.streamId,
        direction: "request",
      },
    });
    await expect(
      service.handleBootstrapDataFrame({
        payload: toArrayBuffer(
          encodeDataFrame({
            streamId: handle.streamId,
            payloadKind: PayloadKindRawBytes,
            payload: Buffer.from("HTTP/1.1 200 OK\r\n\r\n"),
          }),
        ),
        sandboxInstanceId: SandboxInstanceId,
        sourceBootstrapSessionId: bootstrapTarget.sessionId,
      }),
    ).resolves.toBe(true);
    expect((await waitForTcpData(tcpPair.clientSocket)).toString("utf8")).toBe(
      "HTTP/1.1 200 OK\r\n\r\n",
    );

    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.close",
        streamId: handle.streamId,
        direction: "response",
      },
    });
    await waitForTcpEnd(tcpPair.clientSocket);
  });

  it("pauses TCP client reads when outbound window credit is exhausted and resumes on stream.window", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_backpressure",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry, {
      initialTcpStreamWindowBytes: 3,
    });
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    const messageQueue = createWebSocketMessageQueue(bootstrap.clientSocket);
    await messageQueue.next();
    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.connected",
        streamId: handle.streamId,
      },
    });
    await handle.connected;
    tcpPair.clientSocket.write("abcde");
    const firstFrame = decodeDataFrame(Buffer.from((await messageQueue.next()).data));
    expect(Buffer.from(firstFrame.payload).toString("utf8")).toBe("abc");
    tcpPair.clientSocket.end();

    expect(
      service.handleBootstrapStreamWindow({
        sandboxInstanceId: SandboxInstanceId,
        sourceBootstrapSessionId: bootstrapTarget.sessionId,
        message: {
          type: "stream.window",
          streamId: handle.streamId,
          bytes: 2,
        },
      }),
    ).toBe(true);
    const secondFrame = decodeDataFrame(Buffer.from((await messageQueue.next()).data));
    expect(Buffer.from(secondFrame.payload).toString("utf8")).toBe("de");
    expect(JSON.parse(String((await messageQueue.next()).data))).toEqual({
      type: "ports.tcp.close",
      streamId: handle.streamId,
      direction: "request",
    });
    messageQueue.close();
  });

  it("enforces TCP active stream limits per sandbox and Port Access session", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_limits",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry, {
      maxActiveTcpStreamsPerPortAccessSession: 1,
      maxActiveTcpStreamsPerSandbox: 2,
    });
    const bootstrap = await createWebSocketPair();
    const firstTcpPair = await createTcpSocketPair();
    const secondTcpPair = await createTcpSocketPair();
    const thirdTcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(firstTcpPair, secondTcpPair, thirdTcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: firstTcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    void handle.connected.catch(() => undefined);
    await waitForWebSocketMessage(bootstrap.clientSocket);

    await expect(
      service.openTcpStream({
        client: secondTcpPair.gatewaySocket,
        initialBytes: new Uint8Array(),
        portAccessSessionId: PortAccessSessionId,
        sandboxInstanceId: SandboxInstanceId,
        target: {
          kind: "port",
          port: 5173,
        },
        upstreamProtocol: "http",
      }),
    ).rejects.toThrow("maximum 1 active TCP Port Access streams");

    const secondSessionHandle = await service.openTcpStream({
      client: secondTcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: "pas_port_access_transport_second",
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    void secondSessionHandle.connected.catch(() => undefined);

    await expect(
      service.openTcpStream({
        client: thirdTcpPair.gatewaySocket,
        initialBytes: new Uint8Array(),
        portAccessSessionId: "pas_port_access_transport_third",
        sandboxInstanceId: SandboxInstanceId,
        target: {
          kind: "port",
          port: 5173,
        },
        upstreamProtocol: "http",
      }),
    ).rejects.toThrow("maximum 2 active TCP Port Access streams");
  });

  it("fails TCP streams instead of buffering beyond the stream window bound", async () => {
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_pending_window_bound",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry, {
      initialTcpStreamWindowBytes: 0,
    });
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: new Uint8Array(MaxStreamWindowBytes + 1),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    await waitForWebSocketMessage(bootstrap.clientSocket);
    await service.handleBootstrapTransportMessage({
      sandboxInstanceId: SandboxInstanceId,
      sourceBootstrapSessionId: bootstrapTarget.sessionId,
      message: {
        type: "ports.tcp.connected",
        streamId: handle.streamId,
      },
    });
    await handle.connected;

    expect(
      JSON.parse(String((await waitForWebSocketMessage(bootstrap.clientSocket)).data)),
    ).toEqual({
      type: "ports.tcp.close",
      streamId: handle.streamId,
      direction: "request",
    });
  });

  it("fails a TCP stream when sandboxd does not connect before the connect timeout", async () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const bootstrapTarget = createBootstrapTarget({
      sessionId: "sess_bootstrap_tcp_connect_timeout",
    });
    const tunnelSessionRegistry = createTunnelSessionRegistryWithBootstrap({
      bootstrapTarget,
    });
    const service = new PortAccessTransportService(relayCoordinator, tunnelSessionRegistry, {
      clock,
      connectTimeoutMs: 10,
      scheduler,
    });
    const bootstrap = await createWebSocketPair();
    const tcpPair = await createTcpSocketPair();
    openWebSocketPairs.push(bootstrap);
    openTcpSocketPairs.push(tcpPair);

    relayCoordinator.attachPeer({
      ...bootstrapTarget,
      socket: bootstrap.peerSocket,
    });

    const handle = await service.openTcpStream({
      client: tcpPair.gatewaySocket,
      initialBytes: new Uint8Array(),
      portAccessSessionId: PortAccessSessionId,
      sandboxInstanceId: SandboxInstanceId,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "http",
    });
    const connectedFailure = handle.connected.then(
      () => {
        throw new Error("Expected TCP connection to time out.");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
          throw new Error("Expected TCP connection timeout to be an Error.");
        }
        expect(error.message).toContain("did not connect");
      },
    );
    await waitForWebSocketMessage(bootstrap.clientSocket);

    clock.advanceMs(10);
    scheduler.runDue();
    await connectedFailure;

    expect(
      JSON.parse(String((await waitForWebSocketMessage(bootstrap.clientSocket)).data)),
    ).toEqual({
      type: "ports.tcp.close",
      streamId: handle.streamId,
      direction: "request",
    });
  });
});
