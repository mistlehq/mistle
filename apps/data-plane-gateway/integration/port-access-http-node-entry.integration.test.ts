/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

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

function createCookieHeader(token: string): string {
  return `${PortAccessSessionCookieName}=${token}`;
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
    host: input.host,
    port: input.port,
    sandboxInstanceId: input.sandboxInstanceId,
    upstreamProtocol: input.upstreamProtocol ?? "http",
  });
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

function sendRuntimeHttpRequest(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
}> {
  const url = new URL(input.path, input.fixture.baseUrl);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        headers: input.headers,
        method: input.method,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );

    request.on("error", reject);
    if (input.body !== undefined) {
      request.write(input.body);
    }
    request.end();
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

async function sendTargetClose(input: {
  bootstrapSocket: WebSocket;
  streamId: number;
}): Promise<void> {
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "ports.tcp.close",
      direction: "response",
      streamId: input.streamId,
    }),
  );
}

async function closeWebSocketIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    await closeWebSocket(socket);
  }
}

describe("port access HTTP Node entry integration", () => {
  it("intercepts Port Access hosts before Hono and proxies ordinary HTTP as raw ports.tcp bytes", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_http_tcp_success";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_http_tcp_success",
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
      host,
      port,
      sandboxInstanceId,
    });
    const messageQueue = createBootstrapMessageQueue(bootstrapSocket);

    try {
      const responsePromise = sendRuntimeHttpRequest({
        body: "hello-body",
        fixture,
        headers: {
          cookie: `${createCookieHeader(sessionToken)}; theme=dark`,
          host,
          origin: `https://${host}`,
          "x-request-marker": "req-123",
        },
        method: "POST",
        path: "/demo/path?color=blue",
      });

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

      const requestHeadFrame = await withTimeout({
        label: "waiting for request head",
        promise: messageQueue.next(),
      });
      if (requestHeadFrame.kind !== "data") {
        throw new Error("Expected request head data frame.");
      }
      const requestHead = Buffer.from(requestHeadFrame.frame.payload).toString("utf8");
      expect(requestHead).toContain("POST /demo/path?color=blue HTTP/1.1\r\n");
      expect(requestHead).toContain(`Host: 127.0.0.1:${String(port)}\r\n`);
      expect(requestHead).toContain(`origin: http://127.0.0.1:${String(port)}\r\n`);
      expect(requestHead).toContain("cookie: theme=dark\r\n");
      expect(requestHead).toContain("x-request-marker: req-123\r\n");
      expect(requestHead).toContain(`X-Forwarded-Host: ${host}\r\n`);
      expect(requestHead).toContain("X-Forwarded-Port: 80\r\n");
      expect(requestHead).toContain("X-Forwarded-Proto: http\r\n");
      expect(requestHead).not.toContain(PortAccessSessionCookieName);

      const requestBodyFrame = await withTimeout({
        label: "waiting for request body",
        promise: messageQueue.next(),
      });
      if (requestBodyFrame.kind !== "data") {
        throw new Error("Expected request body data frame.");
      }
      expect(Buffer.from(requestBodyFrame.frame.payload).toString("utf8")).toBe(
        "a\r\nhello-body\r\n",
      );

      await sendTargetBytes({
        bootstrapSocket,
        bytes: Buffer.from(
          [
            "HTTP/1.1 200 OK",
            "Content-Type: text/plain",
            "Content-Length: 11",
            "",
            "hello-world",
          ].join("\r\n"),
          "utf8",
        ),
        streamId: openMessage.message.streamId,
      });
      await sendTargetClose({
        bootstrapSocket,
        streamId: openMessage.message.streamId,
      });

      await expect(
        withTimeout({
          label: "waiting for HTTP client response",
          promise: responsePromise,
        }),
      ).resolves.toEqual({
        body: "hello-world",
        headers: expect.objectContaining({
          "content-type": "text/plain",
        }),
        status: 200,
      });
    } finally {
      messageQueue.close();
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("continues delegating non-Port-Access routes to Hono", async ({ fixture }) => {
    const response = await fetch(new URL("/__healthz", fixture.baseUrl));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects HTTP requests with 401 when the port access session cookie is missing", async ({
    fixture,
  }) => {
    const response = await sendRuntimeHttpRequest({
      fixture,
      headers: {
        host: deriveAccessHost({
          fixture,
          port: 5173,
          sandboxInstanceId: "sbi_port_access_http_missing_cookie",
        }),
      },
      method: "GET",
      path: "/demo/path",
    });

    expect(response).toEqual({
      body: "Invalid or expired Port Access session.",
      headers: expect.objectContaining({
        "content-type": "text/plain; charset=utf-8",
      }),
      status: 401,
    });
  });

  it("rejects HTTP requests with 401 when the port access session cookie is invalid", async ({
    fixture,
  }) => {
    const response = await sendRuntimeHttpRequest({
      fixture,
      headers: {
        cookie: createCookieHeader("not-a-valid-session-token"),
        host: deriveAccessHost({
          fixture,
          port: 5173,
          sandboxInstanceId: "sbi_port_access_http_invalid_cookie",
        }),
      },
      method: "GET",
      path: "/demo/path",
    });

    expect(response.status).toBe(401);
    expect(response.body).toBe("Invalid or expired Port Access session.");
  });

  it("rejects HTTP requests with 401 when the port access session cookie is expired", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_http_expired_cookie";
    const port = 5173;
    const host = deriveAccessHost({
      fixture,
      port,
      sandboxInstanceId,
    });
    const sessionToken = await mintSessionToken({
      clock: createMutableClock(1_000),
      fixture,
      host,
      port,
      sandboxInstanceId,
    });

    const response = await sendRuntimeHttpRequest({
      fixture,
      headers: {
        cookie: createCookieHeader(sessionToken),
        host,
      },
      method: "GET",
      path: "/demo/path",
    });

    expect(response.status).toBe(401);
    expect(response.body).toBe("Invalid or expired Port Access session.");
  });

  it("rejects HTTP requests with 401 when the port access session cookie binding does not match", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_http_binding_mismatch";
    const port = 5173;
    const host = deriveAccessHost({
      fixture,
      port,
      sandboxInstanceId,
    });
    const sessionToken = await mintSessionToken({
      fixture,
      host,
      port,
      sandboxInstanceId,
    });

    const response = await sendRuntimeHttpRequest({
      fixture,
      headers: {
        cookie: createCookieHeader(sessionToken),
        host: deriveAccessHost({
          fixture,
          port: 5174,
          sandboxInstanceId,
        }),
      },
      method: "GET",
      path: "/demo/path",
    });

    expect(response.status).toBe(401);
    expect(response.body).toBe("Invalid or expired Port Access session.");
  });
});
