/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { derivePortAccessHost } from "@mistle/port-access-auth";
import {
  decodeDataFrame,
  encodeDataFrame,
  parsePortsControlMessage,
  parsePortsTransportMessage,
  parseStreamControlMessage,
  PayloadKindRawBytes,
  type PortsControlMessage,
  type PortsTransportMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemClock, systemScheduler, type TimerHandle } from "@mistle/time";
import { createMutableClock } from "@mistle/time/testing";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket, { type RawData } from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
} from "../integration/websocket-test-helpers.js";
import {
  PortAccessSessionCookieName,
  mintPortAccessSession,
} from "../src/publishing/auth/port-access-session.js";

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const PortAccessBaseDomain = "mistle.localhost";
const PortAccessCookieSigningSecret = "integration-new-port-access-cookie-secret";
const StepTimeoutMs = 5_000;
const TestTimeoutMs = 40_000;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

type BootstrapInbound =
  | {
      kind: "control";
      message: PortsControlMessage | PortsTransportMessage | StreamControlMessage;
    }
  | {
      frame: ReturnType<typeof decodeDataFrame>;
      kind: "data";
    };

type BootstrapMessageQueue = {
  close: () => void;
  next: () => Promise<BootstrapInbound>;
};

type FailedRawUpgradeResult = {
  body: string;
  statusLine: string;
};

describe.concurrent("port access websocket integration", () => {
  it(
    "routes websocket upgrades through raw ports.tcp bytes before app websocket handling",
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
      const host = deriveAccessHost({
        sandboxInstanceId,
        port,
      });
      const sessionToken = await mintSessionToken({
        sandboxInstanceId,
        port,
        host,
      });
      const messageQueue = createBootstrapMessageQueue(bootstrapSocket);
      let clientSocket: Socket | undefined;

      try {
        clientSocket = await connectRawClient(env);
        clientSocket.write(
          [
            "GET /socket/echo?mode=full HTTP/1.1",
            `Host: ${host}`,
            `Cookie: ${createCookieHeader(sessionToken)}; theme=dark`,
            `${TestEnvironmentIdHeader}: ${env.id}`,
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Origin: https://dashboard.mistle.localhost",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits",
            "Sec-WebSocket-Protocol: chat, superchat",
            "",
            "prefetched-upgrade-bytes",
          ].join("\r\n"),
        );

        const tcpOpen = await waitForTcpOpen({
          bootstrapSocket,
          messageQueue,
          port,
        });

        expect(tcpOpen).toEqual({
          type: "ports.tcp.open",
          streamId: expect.any(Number),
          target: {
            kind: "port",
            port,
          },
          upstreamProtocol: "http",
        });

        await sendTcpConnected({
          bootstrapSocket,
          streamId: tcpOpen.streamId,
        });

        const requestFrame = await waitForDataFrame({
          messageQueue,
          streamId: tcpOpen.streamId,
        });

        const requestHead = Buffer.from(requestFrame.frame.payload).toString("utf8");
        expect(requestHead).toContain("GET /socket/echo?mode=full HTTP/1.1\r\n");
        expect(requestHead).toContain(`Host: 127.0.0.1:${String(port)}\r\n`);
        expect(requestHead).toContain(`Origin: http://${host}\r\n`);
        expect(requestHead).toContain("Connection: Upgrade\r\n");
        expect(requestHead).toContain("Upgrade: websocket\r\n");
        expect(requestHead).toContain("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n");
        expect(requestHead).toContain("Sec-WebSocket-Version: 13\r\n");
        expect(requestHead).toContain(
          "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n",
        );
        expect(requestHead).toContain("Sec-WebSocket-Protocol: chat, superchat\r\n");
        expect(requestHead).toContain("Cookie: theme=dark\r\n");
        expect(requestHead).toContain(`X-Forwarded-Host: ${host}\r\n`);
        expect(requestHead).toContain("X-Forwarded-Proto: http\r\n");
        expect(requestHead).toContain("X-Forwarded-Port: 80\r\n");
        expect(requestHead).toContain("\r\n\r\nprefetched-upgrade-bytes");
        expect(requestHead).not.toContain(PortAccessSessionCookieName);

        await sendTargetBytes({
          bootstrapSocket,
          bytes: Buffer.from(
            [
              "HTTP/1.1 101 Switching Protocols",
              "Connection: Upgrade",
              "Upgrade: websocket",
              "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
              "Sec-WebSocket-Protocol: superchat",
              "",
              "",
            ].join("\r\n"),
            "utf8",
          ),
          streamId: tcpOpen.streamId,
        });
        const clientResponse = await waitForSocketBytes({
          label: "waiting for raw upgrade response",
          predicate: (bytes) => bytes.includes("HTTP/1.1 101 Switching Protocols\r\n"),
          socket: clientSocket,
        });
        expect(clientResponse.toString("utf8")).toContain("Sec-WebSocket-Protocol: superchat");

        clientSocket.destroy();
        clientSocket = undefined;
        const closeMessage = await waitForTcpClose({
          messageQueue,
          streamId: tcpOpen.streamId,
        });
        expect(closeMessage.direction).toBe("request");
      } finally {
        messageQueue.close();
        await closeRawClient(clientSocket);
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it("rejects missing, invalid, expired, and host-mismatched session cookies", async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    const port = 5173;
    const host = deriveAccessHost({
      sandboxInstanceId,
      port,
    });
    const validSessionToken = await mintSessionToken({
      sandboxInstanceId,
      port,
      host,
    });
    const expiredSessionToken = await mintSessionToken({
      sandboxInstanceId,
      port,
      host,
      clock: createMutableClock(1_000),
    });

    await expectUnauthorizedUpgrade({
      env,
      host,
      cookieHeader: null,
    });
    await expectUnauthorizedUpgrade({
      env,
      host,
      cookieHeader: createCookieHeader("not-a-valid-session-token"),
    });
    await expectUnauthorizedUpgrade({
      env,
      host,
      cookieHeader: createCookieHeader(expiredSessionToken),
    });
    await expectUnauthorizedUpgrade({
      env,
      host: deriveAccessHost({
        sandboxInstanceId,
        port: 5174,
      }),
      cookieHeader: createCookieHeader(validSessionToken),
    });
  });
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_port_access_websocket",
    sandboxProfileId: "sbp_integration_new_port_access_websocket",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_port_access_websocket",
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
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

async function mintSessionToken(input: {
  sandboxInstanceId: string;
  port: number;
  host: string;
  clock?: Parameters<typeof mintPortAccessSession>[0]["clock"];
}): Promise<string> {
  return await mintPortAccessSession({
    config: {
      cookieSigningSecret: PortAccessCookieSigningSecret,
    },
    clock: input.clock ?? systemClock,
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
    host: input.host,
    upstreamProtocol: "http",
  });
}

function deriveAccessHost(input: { sandboxInstanceId: string; port: number }): string {
  return derivePortAccessHost({
    config: {
      baseDomain: PortAccessBaseDomain,
    },
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
  });
}

function createCookieHeader(token: string): string {
  return `${PortAccessSessionCookieName}=${token}`;
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

function createBootstrapMessageQueue(socket: WebSocket): BootstrapMessageQueue {
  const queuedMessages: BootstrapInbound[] = [];
  const waitingResolvers: Array<(message: BootstrapInbound) => void> = [];

  const onMessage = (data: RawData, isBinary: boolean): void => {
    const message: BootstrapInbound = isBinary
      ? {
          frame: decodeDataFrame(toBuffer(data)),
          kind: "data",
        }
      : {
          kind: "control",
          message: parsePortsMessage(toBuffer(data).toString("utf8")),
        };
    const waitingResolver = waitingResolvers.shift();
    if (waitingResolver !== undefined) {
      waitingResolver(message);
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

      return await new Promise<BootstrapInbound>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

function parsePortsMessage(
  input: string,
): PortsControlMessage | PortsTransportMessage | StreamControlMessage {
  const parsedTransportMessage = parsePortsTransportMessage(input);
  if (parsedTransportMessage !== undefined) {
    return parsedTransportMessage;
  }

  const parsedControlMessage = parsePortsControlMessage(input);
  if (parsedControlMessage !== undefined) {
    return parsedControlMessage;
  }

  const parsedStreamControlMessage = parseStreamControlMessage(input);
  if (parsedStreamControlMessage !== undefined) {
    return parsedStreamControlMessage;
  }

  throw new Error(`Expected stream, ports control, or ports transport message, got ${input}.`);
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
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

function waitForSocketBytes(input: {
  label: string;
  socket: Socket;
  predicate: (bytes: Buffer) => boolean;
}): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return withTimeout({
    label: input.label,
    promise: new Promise((resolve, reject) => {
      const cleanup = (): void => {
        input.socket.off("data", onData);
        input.socket.off("error", onError);
      };
      const onData = (chunk: Buffer): void => {
        chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        if (input.predicate(bytes)) {
          cleanup();
          resolve(bytes);
        }
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      input.socket.on("data", onData);
      input.socket.once("error", onError);
    }),
  });
}

async function sendTcpConnected(input: {
  bootstrapSocket: WebSocket;
  streamId: number;
}): Promise<void> {
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "ports.tcp.connected",
      streamId: input.streamId,
    }),
  );
}

async function waitForTcpOpen(input: {
  bootstrapSocket: WebSocket;
  messageQueue: BootstrapMessageQueue;
  port: number;
}): Promise<Extract<PortsTransportMessage, { type: "ports.tcp.open" }>> {
  const firstMessage = await withTimeout({
    label: "waiting for ports target authorization or ports.tcp.open",
    promise: input.messageQueue.next(),
  });
  if (firstMessage.kind !== "control") {
    throw new Error("Expected a control message before TCP stream bytes.");
  }

  if (firstMessage.message.type === "ports.tcp.open") {
    return firstMessage.message;
  }

  if (firstMessage.message.type !== "ports.target.authorize") {
    throw new Error(`Expected ports.target.authorize, got '${firstMessage.message.type}'.`);
  }
  expect(firstMessage.message).toEqual({
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
      requestId: firstMessage.message.requestId,
      authorized: true,
      upstreamProtocol: "http",
      websocketCapable: true,
    }),
  );

  const secondMessage = await withTimeout({
    label: "waiting for ports.tcp.open after target authorization",
    promise: input.messageQueue.next(),
  });
  if (secondMessage.kind !== "control" || secondMessage.message.type !== "ports.tcp.open") {
    throw new Error("Expected ports.tcp.open message after target authorization.");
  }

  return secondMessage.message;
}

async function waitForDataFrame(input: {
  messageQueue: BootstrapMessageQueue;
  streamId: number;
}): Promise<Extract<BootstrapInbound, { kind: "data" }>> {
  while (true) {
    const message = await withTimeout({
      label: "waiting for websocket request head bytes",
      promise: input.messageQueue.next(),
    });
    if (message.kind === "data") {
      if (message.frame.streamId !== input.streamId) {
        throw new Error(
          `Expected data frame for stream ${String(input.streamId)}, got stream ${String(message.frame.streamId)}.`,
        );
      }

      return message;
    }

    if (message.message.type === "stream.window" && message.message.streamId === input.streamId) {
      assertPositiveWindowBytes(message.message.bytes);
      continue;
    }

    throw new Error(`Expected raw TCP data frame, got '${message.message.type}'.`);
  }
}

async function waitForTcpClose(input: {
  messageQueue: BootstrapMessageQueue;
  streamId: number;
}): Promise<Extract<PortsTransportMessage, { type: "ports.tcp.close" }>> {
  while (true) {
    const message = await withTimeout({
      label: "waiting for client close propagation",
      promise: input.messageQueue.next(),
    });
    if (message.kind === "data") {
      throw new Error("Expected control message while waiting for TCP close.");
    }

    if (message.message.type === "stream.window" && message.message.streamId === input.streamId) {
      assertPositiveWindowBytes(message.message.bytes);
      continue;
    }

    if (message.message.type === "ports.tcp.close" && message.message.streamId === input.streamId) {
      return message.message;
    }

    throw new Error(`Expected ports.tcp.close, got '${message.message.type}'.`);
  }
}

function assertPositiveWindowBytes(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new Error(`Expected stream.window bytes to be a positive integer, got ${String(bytes)}.`);
  }
}

async function sendTargetBytes(input: {
  bootstrapSocket: WebSocket;
  bytes: Buffer;
  streamId: number;
}): Promise<void> {
  await sendWebSocketMessage(
    input.bootstrapSocket,
    Buffer.from(
      encodeDataFrame({
        payload: input.bytes,
        payloadKind: PayloadKindRawBytes,
        streamId: input.streamId,
      }),
    ),
  );
}

async function connectPortAccessUpgradeExpectFailure(input: {
  cookieHeader: string | null;
  env: IntegrationTestEnvironment;
  host: string;
  path: string;
}): Promise<FailedRawUpgradeResult> {
  const socket = await connectRawClient(input.env);
  try {
    socket.write(
      [
        `GET ${input.path} HTTP/1.1`,
        `Host: ${input.host}`,
        `${TestEnvironmentIdHeader}: ${input.env.id}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        ...(input.cookieHeader === null ? [] : [`Cookie: ${input.cookieHeader}`]),
        "",
        "",
      ].join("\r\n"),
    );
    const bytes = await waitForSocketBytes({
      label: "waiting for failed websocket upgrade response",
      predicate: (receivedBytes) => receivedBytes.includes("\r\n\r\n"),
      socket,
    });
    const rawResponse = bytes.toString("utf8");
    const separatorIndex = rawResponse.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      throw new Error("Expected HTTP response header separator.");
    }

    return {
      body: rawResponse.slice(separatorIndex + 4),
      statusLine: rawResponse.slice(0, rawResponse.indexOf("\r\n")),
    };
  } finally {
    await closeRawClient(socket);
  }
}

async function expectUnauthorizedUpgrade(input: {
  env: IntegrationTestEnvironment;
  host: string;
  cookieHeader: string | null;
}): Promise<void> {
  const result = await connectPortAccessUpgradeExpectFailure({
    env: input.env,
    host: input.host,
    path: "/socket/auth",
    cookieHeader: input.cookieHeader,
  });

  expect(result.statusLine).toBe("HTTP/1.1 401 Unauthorized");
  expect(result.body).toBe("Invalid or expired Port Access session.");
}

async function withTimeout<T>(input: {
  label: string;
  promise: Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  let timeoutHandle: TimerHandle | undefined;

  try {
    return await Promise.race([
      input.promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = systemScheduler.schedule(() => {
          reject(
            new Error(
              `${input.label} timed out after ${String(input.timeoutMs ?? StepTimeoutMs)}ms.`,
            ),
          );
        }, input.timeoutMs ?? StepTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      systemScheduler.cancel(timeoutHandle);
    }
  }
}

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  if (socket.readyState === WebSocket.OPEN) {
    await withTimeout({
      label: "waiting for bootstrap websocket close",
      promise: closeWebSocket(socket),
      timeoutMs: 1_000,
    });
    return;
  }

  await withTimeout({
    label: "waiting for bootstrap websocket close",
    promise: waitForWebSocketClose(socket),
    timeoutMs: 1_000,
  });
}

function waitForWebSocketClose(socket: WebSocket): Promise<void> {
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
