/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { connect, type Socket } from "node:net";

import { derivePortAccessHost } from "@mistle/port-access-auth";
import {
  decodeDataFrame,
  encodeDataFrame,
  parsePortsTransportMessage,
  PayloadKindRawBytes,
  type PortsTransportMessage,
} from "@mistle/sandbox-session-protocol";
import { systemClock, systemScheduler, type TimerHandle } from "@mistle/time";
import { createMutableClock } from "@mistle/time/testing";
import { describe, expect } from "vitest";
import WebSocket, { type RawData } from "ws";

import {
  PortAccessSessionCookieName,
  mintPortAccessSession,
} from "../src/publishing/auth/port-access-session.js";
import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
} from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import { closeWebSocket, sendWebSocketMessage } from "./websocket-test-helpers.js";

const StepTimeoutMs = 5_000;

type BootstrapInbound =
  | {
      kind: "control";
      message: PortsTransportMessage;
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

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function deriveAccessHost(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  port: number;
}): string {
  return derivePortAccessHost({
    config: {
      baseDomain: input.fixture.config.app.sandbox.publish.baseDomain,
    },
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
  });
}

async function mintSessionToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  port: number;
  host: string;
  upstreamProtocol?: "http" | "https";
  clock?: Parameters<typeof mintPortAccessSession>[0]["clock"];
}): Promise<string> {
  return mintPortAccessSession({
    config: {
      cookieSigningSecret: input.fixture.config.app.sandbox.publish.session.cookieSigningSecret,
    },
    clock: input.clock ?? systemClock,
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
    host: input.host,
    upstreamProtocol: input.upstreamProtocol ?? "http",
  });
}

function createCookieHeader(token: string): string {
  return `${PortAccessSessionCookieName}=${token}`;
}

function parseTransportMessage(input: string | Buffer): PortsTransportMessage {
  if (typeof input !== "string") {
    throw new Error("Expected text websocket payload.");
  }

  const parsedMessage = parsePortsTransportMessage(input);
  if (parsedMessage === undefined) {
    throw new Error("Expected ports transport message.");
  }

  return parsedMessage;
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
          message: parseTransportMessage(toBuffer(data).toString("utf8")),
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

      return new Promise<BootstrapInbound>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
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

function connectRawClient(fixture: DataPlaneGatewayIntegrationFixture): Promise<Socket> {
  const baseUrl = new URL(fixture.baseUrl);
  const port = Number.parseInt(baseUrl.port, 10);
  if (!Number.isInteger(port)) {
    throw new Error("Expected fixture baseUrl to include an integer port.");
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

async function closeWebSocketIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    await closeWebSocket(socket);
  }
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
  cookieHeader?: string;
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): Promise<FailedRawUpgradeResult> {
  const socket = await connectRawClient(input.fixture);
  try {
    socket.write(
      [
        `GET ${input.path} HTTP/1.1`,
        `Host: ${input.host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        ...(input.cookieHeader === undefined ? [] : [`Cookie: ${input.cookieHeader}`]),
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

describe("port access websocket integration", () => {
  it("routes websocket upgrades through raw ports.tcp bytes before Hono websocket handling", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_websocket_tcp_success";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_websocket_tcp_success",
    });
    const bootstrapSocket = await connectBootstrapSocket({
      fixture,
      sandboxInstanceId,
      token: await mintValidBootstrapToken({
        fixture,
        sandboxInstanceId,
      }),
    });
    const host = deriveAccessHost({
      fixture,
      sandboxInstanceId,
      port,
    });
    const sessionToken = await mintSessionToken({
      fixture,
      sandboxInstanceId,
      port,
      host,
    });
    const messageQueue = createBootstrapMessageQueue(bootstrapSocket);
    let clientSocket: Socket | undefined;

    try {
      clientSocket = await connectRawClient(fixture);
      clientSocket.write(
        [
          "GET /socket/echo?mode=full HTTP/1.1",
          `Host: ${host}`,
          `Cookie: ${createCookieHeader(sessionToken)}; theme=dark`,
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

      const openMessage = await withTimeout({
        label: "waiting for ports.tcp.open",
        promise: messageQueue.next(),
      });
      if (openMessage.kind !== "control" || openMessage.message.type !== "ports.tcp.open") {
        throw new Error("Expected ports.tcp.open message.");
      }

      expect(openMessage.message).toEqual({
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
        streamId: openMessage.message.streamId,
      });

      const requestFrame = await withTimeout({
        label: "waiting for websocket request head bytes",
        promise: messageQueue.next(),
      });
      if (requestFrame.kind !== "data") {
        throw new Error("Expected raw TCP data frame.");
      }

      const requestHead = Buffer.from(requestFrame.frame.payload).toString("utf8");
      expect(requestHead).toContain("GET /socket/echo?mode=full HTTP/1.1\r\n");
      expect(requestHead).toContain(`Host: 127.0.0.1:${String(port)}\r\n`);
      expect(requestHead).toContain(`Origin: http://127.0.0.1:${String(port)}\r\n`);
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
        streamId: openMessage.message.streamId,
      });
      const clientResponse = await waitForSocketBytes({
        label: "waiting for raw upgrade response",
        predicate: (bytes) => bytes.includes("HTTP/1.1 101 Switching Protocols\r\n"),
        socket: clientSocket,
      });
      expect(clientResponse.toString("utf8")).toContain("Sec-WebSocket-Protocol: superchat");

      const windowMessage = await withTimeout({
        label: "waiting for response byte window",
        promise: messageQueue.next(),
      });
      expect(windowMessage).toEqual({
        kind: "control",
        message: {
          type: "stream.window",
          bytes: expect.any(Number),
          streamId: openMessage.message.streamId,
        },
      });

      clientSocket.destroy();
      clientSocket = undefined;
      const closeMessage = await withTimeout({
        label: "waiting for client close propagation",
        promise: messageQueue.next(),
      });
      expect(closeMessage).toEqual({
        kind: "control",
        message: {
          type: "ports.tcp.close",
          direction: "request",
          streamId: openMessage.message.streamId,
        },
      });
    } finally {
      messageQueue.close();
      await closeRawClient(clientSocket);
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie is missing", async ({
    fixture,
  }) => {
    const result = await connectPortAccessUpgradeExpectFailure({
      fixture,
      host: deriveAccessHost({
        fixture,
        sandboxInstanceId: "sbi_port_access_websocket_missing_cookie",
        port: 5173,
      }),
      path: "/socket/auth",
    });

    expect(result.statusLine).toBe("HTTP/1.1 401 Unauthorized");
    expect(result.body).toBe("Invalid or expired Port Access session.");
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie is invalid", async ({
    fixture,
  }) => {
    const result = await connectPortAccessUpgradeExpectFailure({
      cookieHeader: createCookieHeader("not-a-valid-session-token"),
      fixture,
      host: deriveAccessHost({
        fixture,
        sandboxInstanceId: "sbi_port_access_websocket_invalid_cookie",
        port: 5173,
      }),
      path: "/socket/auth",
    });

    expect(result.statusLine).toBe("HTTP/1.1 401 Unauthorized");
    expect(result.body).toBe("Invalid or expired Port Access session.");
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie is expired", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_websocket_expired_cookie";
    const port = 5173;
    const host = deriveAccessHost({
      fixture,
      sandboxInstanceId,
      port,
    });
    const expiredClock = createMutableClock(1_000);
    const sessionToken = await mintSessionToken({
      clock: expiredClock,
      fixture,
      host,
      port,
      sandboxInstanceId,
    });

    const result = await connectPortAccessUpgradeExpectFailure({
      cookieHeader: createCookieHeader(sessionToken),
      fixture,
      host,
      path: "/socket/auth",
    });

    expect(result.statusLine).toBe("HTTP/1.1 401 Unauthorized");
    expect(result.body).toBe("Invalid or expired Port Access session.");
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie binding does not match", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_websocket_binding_mismatch";
    const port = 5173;
    const host = deriveAccessHost({
      fixture,
      sandboxInstanceId,
      port,
    });
    const sessionToken = await mintSessionToken({
      fixture,
      host,
      port,
      sandboxInstanceId,
    });

    const result = await connectPortAccessUpgradeExpectFailure({
      cookieHeader: createCookieHeader(sessionToken),
      fixture,
      host: deriveAccessHost({
        fixture,
        port: 5174,
        sandboxInstanceId,
      }),
      path: "/socket/auth",
    });

    expect(result.statusLine).toBe("HTTP/1.1 401 Unauthorized");
    expect(result.body).toBe("Invalid or expired Port Access session.");
  });
});
