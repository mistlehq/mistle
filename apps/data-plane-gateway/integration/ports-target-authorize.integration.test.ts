import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { systemClock } from "@mistle/time";
import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { WSContext } from "hono/ws";
import { typeid } from "typeid-js";
import { afterEach, describe, expect, it as vitestIt } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { PortAccessTransportService } from "../src/publishing/port-access-transport.js";
import {
  PortsTargetAuthorizeBootstrapDisconnectedError,
  PortsTargetAuthorizeService,
  PortsTargetAuthorizeTimedOutError,
} from "../src/publishing/ports-target-authorize-service.js";
import { BootstrapTunnelNotConnectedError } from "../src/tunnel/bootstrap-tunnel-not-connected-error.js";
import { createInMemoryTunnelRelayCoordinator } from "../src/tunnel/create-in-memory-relay-coordinator.js";
import { LocalGatewayForwardingClientAdapter } from "../src/tunnel/gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../src/tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../src/tunnel/gateway-forwarding/interactive-stream-router.js";
import { InMemorySandboxOwnerStore } from "../src/tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { StoreBackedSandboxOwnerResolver } from "../src/tunnel/ownership/store-backed-sandbox-owner-resolver.js";
import { TunnelProtocolTranslator } from "../src/tunnel/protocol/tunnel-protocol-translator.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../src/tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../src/tunnel/tunnel-session/index.js";
import type { RelayPeerSocket, RelayTarget } from "../src/tunnel/types.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

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
const BootstrapSessionId = "sess_bootstrap";
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

function waitForWebSocketPairMessage(socket: WebSocket): Promise<ReceivedWebSocketMessage> {
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

function createBootstrapTarget(input: { sandboxInstanceId: string }): RelayTarget {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    side: "bootstrap",
    nodeId: LocalNodeId,
    sessionId: BootstrapSessionId,
  };
}

async function createTranslator(input: {
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  sandboxInstanceId: string;
}): Promise<TunnelProtocolTranslator> {
  const ownerStore = new InMemorySandboxOwnerStore(systemClock);
  await ownerStore.claimOwner({
    sandboxInstanceId: input.sandboxInstanceId,
    nodeId: LocalNodeId,
    sessionId: BootstrapSessionId,
    ttlMs: 60_000,
  });

  const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
  registry.attachBootstrapSession({
    sandboxInstanceId: input.sandboxInstanceId,
    side: "bootstrap",
    nodeId: LocalNodeId,
    sessionId: BootstrapSessionId,
  });

  const forwardingServer = new LocalGatewayForwardingServerAdapter(registry);
  const forwardingClient = new LocalGatewayForwardingClientAdapter(LocalNodeId, forwardingServer);
  const router = new InteractiveStreamRouter(
    LocalNodeId,
    new StoreBackedSandboxOwnerResolver(LocalNodeId, ownerStore),
    forwardingClient,
  );
  const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);

  return new TunnelProtocolTranslator(
    router,
    input.portsTargetAuthorizeService,
    new PortAccessTransportService(relayCoordinator),
  );
}

afterEach(async () => {
  while (openWebSocketPairs.length > 0) {
    await openWebSocketPairs.pop()?.closeAll();
  }
});

async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_data_plane_gateway_integration",
    sandboxProfileId: "sbp_data_plane_gateway_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
  });
}

describe("ports target authorize integration", () => {
  vitestIt("fails fast when no bootstrap peer is connected", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const service = new PortsTargetAuthorizeService(relayCoordinator, scheduler);

    await expect(
      service.requestTargetAuthorize({
        sandboxInstanceId: "sbi_missing_bootstrap",
        target: {
          kind: "port",
          port: 5173,
        },
      }),
    ).rejects.toBeInstanceOf(BootstrapTunnelNotConnectedError);
  });

  vitestIt(
    "resolves a pending authorize request when the translator receives the matching bootstrap result",
    async () => {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
      const service = new PortsTargetAuthorizeService(relayCoordinator, scheduler);
      const translator = await createTranslator({
        portsTargetAuthorizeService: service,
        sandboxInstanceId: "sbi_port_access",
      });
      const websocketPair = await createWebSocketPair();
      openWebSocketPairs.push(websocketPair);

      relayCoordinator.attachPeer({
        ...createBootstrapTarget({
          sandboxInstanceId: "sbi_port_access",
        }),
        socket: websocketPair.peerSocket,
      });

      const resultPromise = service.requestTargetAuthorize({
        sandboxInstanceId: "sbi_port_access",
        target: {
          kind: "port",
          port: 5173,
        },
      });

      const outboundMessage = await waitForWebSocketPairMessage(websocketPair.clientSocket);
      expect(outboundMessage.isBinary).toBe(false);
      const authorizeRequest = JSON.parse(String(outboundMessage.data));
      expect(authorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: authorizeRequest.requestId,
        target: {
          kind: "port",
          port: 5173,
        },
      });

      await expect(
        translator.translateInboundMessage({
          clientSessionId: BootstrapSessionId,
          payload: JSON.stringify({
            type: "ports.target.authorize.result",
            requestId: authorizeRequest.requestId,
            authorized: true,
            upstreamProtocol: "https",
            websocketCapable: true,
          }),
          sandboxInstanceId: "sbi_port_access",
          sourcePeerSide: "bootstrap",
        }),
      ).resolves.toEqual({
        delivery: {
          kind: "drop",
        },
      });

      await expect(resultPromise).resolves.toEqual({
        type: "ports.target.authorize.result",
        requestId: authorizeRequest.requestId,
        authorized: true,
        upstreamProtocol: "https",
        websocketCapable: true,
      });
    },
  );

  vitestIt("times out pending authorize requests after five seconds", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
    const service = new PortsTargetAuthorizeService(relayCoordinator, scheduler);
    const websocketPair = await createWebSocketPair();
    openWebSocketPairs.push(websocketPair);

    relayCoordinator.attachPeer({
      ...createBootstrapTarget({
        sandboxInstanceId: "sbi_port_access_timeout",
      }),
      socket: websocketPair.peerSocket,
    });

    const resultPromise = service.requestTargetAuthorize({
      sandboxInstanceId: "sbi_port_access_timeout",
      target: {
        kind: "port",
        port: 8080,
      },
    });

    await waitForWebSocketPairMessage(websocketPair.clientSocket);

    clock.advanceMs(5_000);
    expect(scheduler.runDue()).toBe(1);

    await expect(resultPromise).rejects.toBeInstanceOf(PortsTargetAuthorizeTimedOutError);
  });

  it("rejects pending authorize requests when the bootstrap websocket closes", async ({
    fixture,
  }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
    });
    const bootstrapToken = await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
        tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
        tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId,
      ttlSeconds: 120,
    });
    const bootstrapSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "bootstrap",
      token: bootstrapToken,
    });

    try {
      const resultPromise =
        fixture.runtime.internals.portsTargetAuthorizeService.requestTargetAuthorize({
          sandboxInstanceId,
          target: {
            kind: "port",
            port: 3000,
          },
        });

      const outboundMessage = await waitForWebSocketMessage(bootstrapSocket);
      expect(outboundMessage.isBinary).toBe(false);
      expect(JSON.parse(String(outboundMessage.data))).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 3000,
        },
      });

      const resultRejection = expect(resultPromise).rejects.toBeInstanceOf(
        PortsTargetAuthorizeBootstrapDisconnectedError,
      );
      await closeWebSocket(bootstrapSocket);

      await resultRejection;
    } finally {
      if (bootstrapSocket.readyState === WebSocket.OPEN) {
        await closeWebSocket(bootstrapSocket);
      }
    }
  });

  it("round-trips connection-side target authorization through the bootstrap websocket", async ({
    fixture,
  }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
    });
    const bootstrapToken = await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
        tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
        tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId,
      ttlSeconds: 120,
    });
    const connectionToken = await mintConnectionToken({
      config: {
        connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
        tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
        tokenAudience: fixture.config.sandbox.connect.tokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId,
      ttlSeconds: 120,
    });
    const bootstrapSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "bootstrap",
      token: bootstrapToken,
    });
    const connectionSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "connect",
      token: connectionToken,
    });

    try {
      connectionSocket.send(
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_connection_1",
          target: {
            kind: "port",
            port: 5173,
          },
        }),
      );

      const outboundMessage = await waitForWebSocketMessage(bootstrapSocket);
      expect(outboundMessage.isBinary).toBe(false);
      expect(JSON.parse(String(outboundMessage.data))).toEqual({
        type: "ports.target.authorize",
        requestId: "req_connection_1",
        target: {
          kind: "port",
          port: 5173,
        },
      });

      bootstrapSocket.send(
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: "req_connection_1",
          authorized: true,
          upstreamProtocol: "http",
          websocketCapable: true,
        }),
      );

      const connectionMessage = await waitForWebSocketMessage(connectionSocket);
      expect(connectionMessage.isBinary).toBe(false);
      expect(JSON.parse(String(connectionMessage.data))).toEqual({
        type: "ports.target.authorize.result",
        requestId: "req_connection_1",
        authorized: true,
        upstreamProtocol: "http",
        websocketCapable: true,
      });
    } finally {
      if (connectionSocket.readyState === WebSocket.OPEN) {
        await closeWebSocket(connectionSocket);
      }
      if (bootstrapSocket.readyState === WebSocket.OPEN) {
        await closeWebSocket(bootstrapSocket);
      }
    }
  });
});
