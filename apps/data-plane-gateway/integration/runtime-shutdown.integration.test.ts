/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type Socket } from "node:net";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken, mintEgressToken } from "@mistle/gateway-tunnel-auth";
import { derivePortAccessHost } from "@mistle/port-access-auth";
import {
  SandboxRuntimeStateSnapshotSchema,
  type CompiledRuntimePlan,
  type SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";
import {
  parsePortsControlMessage,
  parsePortsTransportMessage,
  type PortsControlMessage,
  type PortsTransportMessage,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  closeWebSocket,
  connectWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketClose,
} from "../integration/websocket-test-helpers.js";
import {
  DirectEgressTokenHeaderName,
  DirectEgressWebSocketRoutePath,
} from "../src/egress/direct-egress-proxy-service.js";
import {
  PortAccessSessionCookieName,
  mintPortAccessSession,
} from "../src/publishing/auth/port-access-session.js";
import {
  GatewayWebSocketCloseCodes,
  GatewayWebSocketCloseReasons,
} from "../src/runtime/gateway-websocket-close.js";

const TestTimeoutMs = 40_000;
const RuntimeStateReadTimeoutMs = 5_000;
const RuntimeStateReadPollIntervalMs = 50;
const InternalServiceTokenHeader = "x-mistle-service-token";
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const EgressTokenSecret = "integration-new-egress-token-secret";
const EgressTokenIssuer = "integration-new-data-plane-gateway";
const EgressTokenAudience = "integration-new-gateway-egress";
const PortAccessBaseDomain = "mistle.localhost";
const PortAccessCookieSigningSecret = "integration-new-port-access-cookie-secret";
const DirectEgressUpstreamResolutionDelayMs = 750;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally stops the data-plane gateway runtime.",
    services: ["data-plane-gateway"],
  },
});
const itWithDelayedDirectEgressUpstreamResolution = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally stops the data-plane gateway runtime.",
    services: ["data-plane-gateway"],
  },
  __serviceOptions: {
    dataPlaneGateway: {
      directEgress: {
        webSocketUpstreamResolutionDelayMs: DirectEgressUpstreamResolutionDelayMs,
      },
    },
  },
});

it(
  "drains bootstrap close cleanup before runtime shutdown closes runtime-state storage",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });

    let bootstrapSocket: WebSocket | undefined;

    try {
      bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      const attached = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      expect(attached.attachment?.sandboxInstanceId).toBe(sandboxInstanceId);

      const gatewayBaseUrl = env.dataPlaneGateway.hostBaseUrl;
      const bootstrapSocketClose = waitForWebSocketClose(bootstrapSocket);
      await env.dataPlaneGateway.stop();
      bootstrapSocket = undefined;
      await expect(bootstrapSocketClose).resolves.toEqual({
        code: GatewayWebSocketCloseCodes.SERVICE_RESTART,
        reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      });

      await env.dataPlaneGateway.start();
      expect(env.dataPlaneGateway.hostBaseUrl).toBe(gatewayBaseUrl);

      const healthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");
      expect(healthResponse.ok).toBe(true);

      const cleared = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
      });
      expect(cleared.ownerLeaseId).toBeNull();
      expect(cleared.attachment).toBeNull();
    } finally {
      await closeIfOpen(bootstrapSocket);
    }
  },
  TestTimeoutMs,
);

it(
  "closes direct egress websockets with service_restart before runtime shutdown",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });
    const upstream = await startSimulatedWebSocketUpstream();
    let socket: WebSocket | undefined;
    let gatewayStopped = false;

    try {
      const gatewayWebSocketUrl = new URL(
        DirectEgressWebSocketRoutePath,
        env.dataPlaneGateway.hostBaseUrl,
      );
      gatewayWebSocketUrl.protocol = "ws:";
      gatewayWebSocketUrl.searchParams.set("target", `${upstream.baseUrl}/socket`);
      socket = await connectWebSocket(gatewayWebSocketUrl.toString(), {
        headers: {
          [TestEnvironmentIdHeader]: env.id,
          [DirectEgressTokenHeaderName]: `Bearer ${await mintDirectEgressToken({
            organizationId: "org_integration_new_gateway_shutdown",
            sandboxInstanceId,
          })}`,
        },
      });
      await upstream.nextConnection();

      const socketClose = waitForWebSocketClose(socket);
      await env.dataPlaneGateway.stop();
      gatewayStopped = true;
      socket = undefined;

      await expect(socketClose).resolves.toEqual({
        code: GatewayWebSocketCloseCodes.SERVICE_RESTART,
        reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      });
    } finally {
      await closeIfOpen(socket);
      await upstream.close();
      if (gatewayStopped) {
        await env.dataPlaneGateway.start();
      }
    }
  },
  TestTimeoutMs,
);

itWithDelayedDirectEgressUpstreamResolution(
  "does not connect direct egress upstream after shutdown closes the client during upstream resolution",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });
    const upstream = await startSimulatedWebSocketUpstream();
    let socket: WebSocket | undefined;
    let gatewayStopped = false;

    try {
      const gatewayWebSocketUrl = new URL(
        DirectEgressWebSocketRoutePath,
        env.dataPlaneGateway.hostBaseUrl,
      );
      gatewayWebSocketUrl.protocol = "ws:";
      gatewayWebSocketUrl.searchParams.set("target", `${upstream.baseUrl}/socket`);
      socket = await connectWebSocket(gatewayWebSocketUrl.toString(), {
        headers: {
          [TestEnvironmentIdHeader]: env.id,
          [DirectEgressTokenHeaderName]: `Bearer ${await mintDirectEgressToken({
            organizationId: "org_integration_new_gateway_shutdown",
            sandboxInstanceId,
          })}`,
        },
      });

      const socketClose = waitForWebSocketClose(socket);
      await env.dataPlaneGateway.stop();
      gatewayStopped = true;
      socket = undefined;

      await expect(socketClose).resolves.toEqual({
        code: GatewayWebSocketCloseCodes.SERVICE_RESTART,
        reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      });
      await systemSleeper.sleep(DirectEgressUpstreamResolutionDelayMs + 250);
      expect(upstream.connectionCount()).toBe(0);
    } finally {
      await closeIfOpen(socket);
      await upstream.close();
      if (gatewayStopped) {
        await env.dataPlaneGateway.start();
      }
    }
  },
  TestTimeoutMs,
);

it(
  "ends accepted Port Access raw upgraded streams before runtime shutdown",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    const port = 5173;
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });
    const bootstrapSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const messageQueue = createBootstrapMessageQueue(bootstrapSocket);
    const host = deriveAccessHost({
      sandboxInstanceId,
      port,
    });
    const sessionToken = await mintSessionToken({
      sandboxInstanceId,
      port,
      host,
    });
    const receivedClientBytes: Buffer[] = [];
    let clientSocket: Socket | undefined;
    let gatewayStopped = false;

    try {
      clientSocket = await connectRawClient(env);
      clientSocket.on("data", (chunk: Buffer) => {
        receivedClientBytes.push(chunk);
      });
      clientSocket.write(
        [
          "GET /socket/echo HTTP/1.1",
          `Host: ${host}`,
          `Cookie: ${createCookieHeader(sessionToken)}`,
          `${TestEnvironmentIdHeader}: ${env.id}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );

      await waitForTcpOpen({
        bootstrapSocket,
        messageQueue,
        port,
      });
      const clientClose = waitForRawSocketClose(clientSocket);
      await env.dataPlaneGateway.stop();
      gatewayStopped = true;
      clientSocket = undefined;

      await clientClose;
      expect(Buffer.concat(receivedClientBytes).byteLength).toBe(0);
    } finally {
      messageQueue.close();
      await closeRawClient(clientSocket);
      await closeIfOpen(bootstrapSocket);
      if (gatewayStopped) {
        await env.dataPlaneGateway.start();
      }
    }
  },
  TestTimeoutMs,
);

it(
  "ends accepted Port Access raw HTTP streams before runtime shutdown",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    const port = 5173;
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });
    const bootstrapSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const messageQueue = createBootstrapMessageQueue(bootstrapSocket);
    const host = deriveAccessHost({
      sandboxInstanceId,
      port,
    });
    const sessionToken = await mintSessionToken({
      sandboxInstanceId,
      port,
      host,
    });
    const receivedClientBytes: Buffer[] = [];
    let clientSocket: Socket | undefined;
    let gatewayStopped = false;

    try {
      clientSocket = await connectRawClient(env);
      clientSocket.on("data", (chunk: Buffer) => {
        receivedClientBytes.push(chunk);
      });
      clientSocket.write(
        [
          "GET / HTTP/1.1",
          `Host: ${host}`,
          `Cookie: ${createCookieHeader(sessionToken)}`,
          `${TestEnvironmentIdHeader}: ${env.id}`,
          "",
          "",
        ].join("\r\n"),
      );

      const httpOpen = await waitForHttpOpen({
        bootstrapSocket,
        messageQueue,
        port,
      });
      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.http.response.start",
          streamId: httpOpen.streamId,
          status: 200,
          headers: {
            "content-type": ["text/plain"],
          },
        }),
      );
      await waitForCondition(() =>
        Buffer.concat(receivedClientBytes).includes(Buffer.from("HTTP/1.1 200 OK", "utf8")),
      );
      const clientClose = waitForRawSocketClose(clientSocket);
      await env.dataPlaneGateway.stop();
      gatewayStopped = true;
      clientSocket = undefined;

      await clientClose;
      expect(Buffer.concat(receivedClientBytes).toString("utf8")).toContain("HTTP/1.1 200 OK");
    } finally {
      messageQueue.close();
      await closeRawClient(clientSocket);
      await closeIfOpen(bootstrapSocket);
      if (gatewayStopped) {
        await env.dataPlaneGateway.start();
      }
    }
  },
  TestTimeoutMs,
);

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_gateway_shutdown",
    sandboxProfileId: "sbp_integration_new_gateway_shutdown",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_gateway_shutdown",
    source: "webhook",
  });

  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan(),
    compiledFromProfileId: "sbp_integration_new_gateway_shutdown",
    compiledFromProfileVersion: 1,
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function readRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<SandboxRuntimeStateSnapshot> {
  const response = await input.env.dataPlaneGateway.http.fetch(
    `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
    {
      headers: {
        [InternalServiceTokenHeader]: "integration-new-internal-service-token",
      },
    },
  );

  expect(response.status).toBe(200);
  return SandboxRuntimeStateSnapshotSchema.parse(await response.json());
}

async function waitForRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  predicate: (snapshot: SandboxRuntimeStateSnapshot) => boolean;
}): Promise<SandboxRuntimeStateSnapshot> {
  const deadline = Date.now() + RuntimeStateReadTimeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await readRuntimeState({
      env: input.env,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (input.predicate(snapshot)) {
      return snapshot;
    }

    await systemSleeper.sleep(RuntimeStateReadPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime-state snapshot for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + RuntimeStateReadTimeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await systemSleeper.sleep(RuntimeStateReadPollIntervalMs);
  }

  throw new Error("Timed out waiting for integration condition.");
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

function createRuntimePlan(): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_integration_new_gateway_shutdown",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

async function mintDirectEgressToken(input: {
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const minted = await mintEgressToken({
    config: {
      tokenSecret: EgressTokenSecret,
      tokenIssuer: EgressTokenIssuer,
      tokenAudience: EgressTokenAudience,
    },
    claims: {
      sub: input.sandboxInstanceId,
      organizationId: input.organizationId,
      bootstrapSessionId: "bst_gateway_shutdown_direct_egress",
    },
    ttlSeconds: 120,
  });

  return minted.token;
}

type SimulatedWebSocketUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  connectionCount: () => number;
  nextConnection: () => Promise<void>;
};

type BootstrapMessageQueue = {
  close: () => void;
  next: () => Promise<PortsControlMessage | PortsTransportMessage>;
};

function createBootstrapMessageQueue(socket: WebSocket): BootstrapMessageQueue {
  const queuedMessages: Array<PortsControlMessage | PortsTransportMessage> = [];
  const waitingResolvers: Array<(message: PortsControlMessage | PortsTransportMessage) => void> =
    [];

  const onMessage = (data: WebSocket.RawData): void => {
    const messageText = toBuffer(data).toString("utf8");
    const message =
      parsePortsControlMessage(messageText) ?? parsePortsTransportMessage(messageText);
    if (message === undefined) {
      return;
    }

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
      const queuedMessage = queuedMessages.shift();
      if (queuedMessage !== undefined) {
        return queuedMessage;
      }

      return await new Promise<PortsControlMessage | PortsTransportMessage>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

async function waitForTcpOpen(input: {
  bootstrapSocket: WebSocket;
  messageQueue: BootstrapMessageQueue;
  port: number;
}): Promise<Extract<PortsTransportMessage, { type: "ports.tcp.open" }>> {
  const firstMessage = await input.messageQueue.next();
  if (firstMessage.type === "ports.tcp.open") {
    return firstMessage;
  }

  if (firstMessage.type !== "ports.target.authorize") {
    throw new Error(`Expected ports.target.authorize, got '${firstMessage.type}'.`);
  }
  expect(firstMessage).toEqual({
    type: "ports.target.authorize",
    requestId: expect.any(String),
    target: {
      kind: "port",
      port: input.port,
    },
  });

  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "ports.target.authorize.result",
      requestId: firstMessage.requestId,
      authorized: true,
      upstreamProtocol: "http",
      websocketCapable: true,
    }),
  );

  const secondMessage = await input.messageQueue.next();
  if (secondMessage.type !== "ports.tcp.open") {
    throw new Error(`Expected ports.tcp.open, got '${secondMessage.type}'.`);
  }

  return secondMessage;
}

async function waitForHttpOpen(input: {
  bootstrapSocket: WebSocket;
  messageQueue: BootstrapMessageQueue;
  port: number;
}): Promise<Extract<PortsTransportMessage, { type: "ports.http.open" }>> {
  const firstMessage = await input.messageQueue.next();
  if (firstMessage.type === "ports.http.open") {
    return firstMessage;
  }

  if (firstMessage.type !== "ports.target.authorize") {
    throw new Error(`Expected ports.target.authorize, got '${firstMessage.type}'.`);
  }
  expect(firstMessage).toEqual({
    type: "ports.target.authorize",
    requestId: expect.any(String),
    target: {
      kind: "port",
      port: input.port,
    },
  });

  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "ports.target.authorize.result",
      requestId: firstMessage.requestId,
      authorized: true,
      upstreamProtocol: "http",
      websocketCapable: false,
    }),
  );

  const secondMessage = await input.messageQueue.next();
  if (secondMessage.type !== "ports.http.open") {
    throw new Error(`Expected ports.http.open, got '${secondMessage.type}'.`);
  }

  return secondMessage;
}

async function mintSessionToken(input: {
  host: string;
  port: number;
  sandboxInstanceId: string;
}): Promise<string> {
  return await mintPortAccessSession({
    clock: systemClock,
    config: {
      cookieSigningSecret: PortAccessCookieSigningSecret,
    },
    host: input.host,
    port: input.port,
    sandboxInstanceId: input.sandboxInstanceId,
    upstreamProtocol: "http",
  });
}

function deriveAccessHost(input: { port: number; sandboxInstanceId: string }): string {
  return derivePortAccessHost({
    config: {
      baseDomain: PortAccessBaseDomain,
    },
    port: input.port,
    sandboxInstanceId: input.sandboxInstanceId,
  });
}

function createCookieHeader(token: string): string {
  return `${PortAccessSessionCookieName}=${token}`;
}

function connectRawClient(env: IntegrationTestEnvironment): Promise<Socket> {
  const baseUrl = new URL(env.dataPlaneGateway.hostBaseUrl);
  const port = Number.parseInt(baseUrl.port, 10);
  if (!Number.isInteger(port)) {
    throw new Error("Expected gateway base URL to include an integer port.");
  }

  return new Promise((resolve, reject) => {
    const socket = connect({
      host: baseUrl.hostname,
      port,
    });
    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function waitForRawSocketClose(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

function closeRawClient(socket: Socket | undefined): Promise<void> {
  if (socket === undefined || socket.destroyed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", () => {
      resolve();
    });
    socket.destroy();
  });
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

async function startSimulatedWebSocketUpstream(): Promise<SimulatedWebSocketUpstream> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({ server });
  let receivedConnectionCount = 0;
  const waitingConnectionResolvers: Array<() => void> = [];

  webSocketServer.on("connection", (_socket, _request: IncomingMessage) => {
    const resolver = waitingConnectionResolvers.shift();
    if (resolver !== undefined) {
      resolver();
      return;
    }

    receivedConnectionCount += 1;
  });
  const port = await listen(server);

  return {
    baseUrl: `ws://127.0.0.1:${String(port)}`,
    close: async () => {
      await closeWebSocketServer(webSocketServer);
      await closeServer(server);
    },
    connectionCount: () => receivedConnectionCount,
    nextConnection: async () => {
      if (receivedConnectionCount > 0) {
        receivedConnectionCount -= 1;
        return;
      }

      return await new Promise<void>((resolve) => {
        waitingConnectionResolvers.push(resolve);
      });
    },
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected simulated websocket upstream to listen on a TCP port."));
        return;
      }

      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeWebSocketServer(webSocketServer: WebSocketServer): Promise<void> {
  await Promise.all(
    [...webSocketServer.clients].map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.once("close", () => {
            resolve();
          });
          socket.close();
        }),
    ),
  );

  await new Promise<void>((resolve, reject) => {
    webSocketServer.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
