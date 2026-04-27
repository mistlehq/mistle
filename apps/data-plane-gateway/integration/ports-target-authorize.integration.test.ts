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
import { createAttachmentBackedActiveBootstrapSessionStore } from "../src/runtime-state/active-bootstrap-session-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../src/runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { BootstrapTunnelNotConnectedError } from "../src/tunnel/bootstrap-tunnel-not-connected-error.js";
import { createInMemoryTunnelRelayCoordinator } from "../src/tunnel/create-in-memory-relay-coordinator.js";
import { LocalGatewayForwardingClientAdapter } from "../src/tunnel/gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../src/tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../src/tunnel/gateway-forwarding/interactive-stream-router.js";
import { AttachmentBackedSandboxOwnerResolver } from "../src/tunnel/ownership/attachment-backed-sandbox-owner-resolver.js";
import { TunnelProtocolTranslator } from "../src/tunnel/protocol/tunnel-protocol-translator.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../src/tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../src/tunnel/tunnel-session/index.js";
import type { RelayPeerSocket, RelayTarget } from "../src/tunnel/types.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  waitForNoWebSocketMessage,
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
  const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
  await attachmentStore.upsertAttachment({
    sandboxInstanceId: input.sandboxInstanceId,
    ownerLeaseId: "dtl_attached",
    nodeId: LocalNodeId,
    sessionId: BootstrapSessionId,
    attachedAtMs: systemClock.nowMs(),
    ttlMs: 60_000,
    nowMs: systemClock.nowMs(),
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
    new AttachmentBackedSandboxOwnerResolver(
      LocalNodeId,
      createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
      systemClock,
    ),
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

  vitestIt(
    "drops connection-side pending authorize requests when that connection closes",
    async () => {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const relayCoordinator = createInMemoryTunnelRelayCoordinator(LocalNodeId);
      const service = new PortsTargetAuthorizeService(relayCoordinator, scheduler);
      const websocketPair = await createWebSocketPair();
      openWebSocketPairs.push(websocketPair);

      relayCoordinator.attachPeer({
        ...createBootstrapTarget({
          sandboxInstanceId: "sbi_port_access_connection_close",
        }),
        socket: websocketPair.peerSocket,
      });

      await service.forwardConnectionTargetAuthorize({
        sandboxInstanceId: "sbi_port_access_connection_close",
        clientSessionId: "conn_1",
        request: {
          type: "ports.target.authorize",
          requestId: "req_conn_1",
          target: {
            kind: "port",
            port: 5173,
          },
        },
      });
      const firstForwardedRequest = JSON.parse(
        String((await waitForWebSocketPairMessage(websocketPair.clientSocket)).data),
      );

      await service.forwardConnectionTargetAuthorize({
        sandboxInstanceId: "sbi_port_access_connection_close",
        clientSessionId: "conn_2",
        request: {
          type: "ports.target.authorize",
          requestId: "req_conn_2",
          target: {
            kind: "port",
            port: 8080,
          },
        },
      });
      const secondForwardedRequest = JSON.parse(
        String((await waitForWebSocketPairMessage(websocketPair.clientSocket)).data),
      );

      service.rejectPendingRequestsForConnection({
        sandboxInstanceId: "sbi_port_access_connection_close",
        clientSessionId: "conn_1",
      });

      expect(
        service.resolveTargetAuthorizeResult({
          sandboxInstanceId: "sbi_port_access_connection_close",
          result: {
            type: "ports.target.authorize.result",
            requestId: firstForwardedRequest.requestId,
            authorized: true,
            upstreamProtocol: "http",
            websocketCapable: true,
          },
        }),
      ).toBeUndefined();

      expect(
        service.resolveTargetAuthorizeResult({
          sandboxInstanceId: "sbi_port_access_connection_close",
          result: {
            type: "ports.target.authorize.result",
            requestId: secondForwardedRequest.requestId,
            authorized: false,
            reason: "unsupported_protocol",
          },
        }),
      ).toEqual({
        kind: "forward",
        result: {
          type: "ports.target.authorize.result",
          requestId: "req_conn_2",
          authorized: false,
          reason: "unsupported_protocol",
        },
        targetConnectionSessionId: "conn_2",
      });

      clock.advanceMs(5_000);
      expect(scheduler.runDue()).toBe(0);
    },
  );

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
      const bootstrapAuthorizeRequest = JSON.parse(String(outboundMessage.data));
      expect(bootstrapAuthorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 5173,
        },
      });
      expect(bootstrapAuthorizeRequest.requestId).not.toBe("req_connection_1");

      bootstrapSocket.send(
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: bootstrapAuthorizeRequest.requestId,
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

  it("keeps connection-side authorize requests isolated even when two clients reuse the same request id", async ({
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
    const firstConnectionToken = await mintConnectionToken({
      config: {
        connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
        tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
        tokenAudience: fixture.config.sandbox.connect.tokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId,
      ttlSeconds: 120,
    });
    const secondConnectionToken = await mintConnectionToken({
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
    const firstConnectionSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "connect",
      token: firstConnectionToken,
    });
    const secondConnectionSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "connect",
      token: secondConnectionToken,
    });

    try {
      firstConnectionSocket.send(
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_shared",
          target: {
            kind: "port",
            port: 5173,
          },
        }),
      );

      const firstBootstrapAuthorizeRequest = JSON.parse(
        String((await waitForWebSocketMessage(bootstrapSocket)).data),
      );
      expect(firstBootstrapAuthorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 5173,
        },
      });
      expect(firstBootstrapAuthorizeRequest.requestId).not.toBe("req_shared");

      secondConnectionSocket.send(
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_shared",
          target: {
            kind: "port",
            port: 8080,
          },
        }),
      );

      const secondBootstrapAuthorizeRequest = JSON.parse(
        String((await waitForWebSocketMessage(bootstrapSocket)).data),
      );
      expect(secondBootstrapAuthorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 8080,
        },
      });
      expect(secondBootstrapAuthorizeRequest.requestId).not.toBe("req_shared");
      expect(secondBootstrapAuthorizeRequest.requestId).not.toBe(
        firstBootstrapAuthorizeRequest.requestId,
      );

      bootstrapSocket.send(
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: firstBootstrapAuthorizeRequest.requestId,
          authorized: false,
          reason: "unsupported_protocol",
        }),
      );

      const firstConnectionMessage = await waitForWebSocketMessage(firstConnectionSocket);
      expect(firstConnectionMessage.isBinary).toBe(false);
      expect(JSON.parse(String(firstConnectionMessage.data))).toEqual({
        type: "ports.target.authorize.result",
        requestId: "req_shared",
        authorized: false,
        reason: "unsupported_protocol",
      });
      await waitForNoWebSocketMessage(secondConnectionSocket);

      bootstrapSocket.send(
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: secondBootstrapAuthorizeRequest.requestId,
          authorized: true,
          upstreamProtocol: "http",
          websocketCapable: true,
        }),
      );

      const secondConnectionMessage = await waitForWebSocketMessage(secondConnectionSocket);
      expect(secondConnectionMessage.isBinary).toBe(false);
      expect(JSON.parse(String(secondConnectionMessage.data))).toEqual({
        type: "ports.target.authorize.result",
        requestId: "req_shared",
        authorized: true,
        upstreamProtocol: "http",
        websocketCapable: true,
      });
    } finally {
      if (secondConnectionSocket.readyState === WebSocket.OPEN) {
        await closeWebSocket(secondConnectionSocket);
      }
      if (firstConnectionSocket.readyState === WebSocket.OPEN) {
        await closeWebSocket(firstConnectionSocket);
      }
      if (bootstrapSocket.readyState === WebSocket.OPEN) {
        await closeWebSocket(bootstrapSocket);
      }
    }
  });

  it("returns an explicit authorize failure to the connection when the bootstrap disconnects", async ({
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
          requestId: "req_disconnect",
          target: {
            kind: "port",
            port: 5173,
          },
        }),
      );

      const bootstrapAuthorizeRequest = JSON.parse(
        String((await waitForWebSocketMessage(bootstrapSocket)).data),
      );
      expect(bootstrapAuthorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 5173,
        },
      });
      expect(bootstrapAuthorizeRequest.requestId).not.toBe("req_disconnect");

      await closeWebSocket(bootstrapSocket);

      const connectionMessage = await waitForWebSocketMessage(connectionSocket);
      expect(connectionMessage.isBinary).toBe(false);
      expect(JSON.parse(String(connectionMessage.data))).toEqual({
        type: "ports.target.authorize.result",
        requestId: "req_disconnect",
        authorized: false,
        reason: "bootstrap_disconnected",
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
