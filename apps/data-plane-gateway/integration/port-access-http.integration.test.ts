/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { derivePortAccessHost } from "@mistle/port-access-auth";
import {
  parsePortsTransportMessage,
  type PortsTransportMessage,
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

type GatewayHttpResponse = {
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
};

type WebSocketMessageQueue = {
  close: () => void;
  next: () => Promise<PortsTransportMessage>;
};

describe.concurrent("port access http integration", () => {
  it(
    "forwards browser HTTP requests and responses through the ports.http tunnel transport",
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
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const responsePromise = sendGatewayHttpRequest({
          env,
          path: "/demo/path?color=blue&mode=full",
          method: "GET",
          headers: {
            cookie: `${createCookieHeader(sessionToken)}; theme=dark`,
            host,
            origin: `http://${host}`,
            "x-request-marker": "req-123",
          },
        });

        const openMessage = await withTimeout({
          label: "waiting for ports.http.open",
          promise: messageQueue.next(),
        });
        if (openMessage.type !== "ports.http.open") {
          throw new Error("Expected ports.http.open message.");
        }

        expect(openMessage).toEqual({
          type: "ports.http.open",
          streamId: expect.any(Number),
          target: {
            kind: "port",
            port,
          },
          upstreamProtocol: "http",
          request: {
            method: "GET",
            path: "/demo/path",
            query: "color=blue&mode=full",
            headers: expect.objectContaining({
              host: [`127.0.0.1:${String(port)}`],
              origin: [`http://127.0.0.1:${String(port)}`],
              "x-forwarded-host": [host],
              "x-forwarded-port": ["80"],
              "x-forwarded-proto": ["http"],
              "x-request-marker": ["req-123"],
            }),
          },
        });
        expect(openMessage.request.headers.cookie).toEqual(["theme=dark"]);

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.http.response.start",
            streamId: openMessage.streamId,
            status: 201,
            headers: {
              "cache-control": ["no-store"],
              "content-type": ["text/plain; charset=utf-8"],
              "set-cookie": ["a=1; Path=/", "b=2; Path=/"],
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.http.body.chunk",
            streamId: openMessage.streamId,
            direction: "response",
            bytes: Buffer.from("hello from sandboxd", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.http.body.end",
            streamId: openMessage.streamId,
            direction: "response",
          }),
        );

        const response = await withTimeout({
          label: "waiting for browser response",
          promise: responsePromise,
        });
        expect(response.status).toBe(201);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
        expect(response.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; Path=/"]);
        expect(response.body).toBe("hello from sandboxd");
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "forwards browser request bodies through ports.http.body messages",
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
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const responsePromise = sendGatewayHttpRequest({
          env,
          path: "/demo/upload",
          method: "POST",
          headers: {
            "content-type": "text/plain; charset=utf-8",
            cookie: createCookieHeader(sessionToken),
            host,
          },
          body: "hello from the browser",
        });

        const openMessage = await withTimeout({
          label: "waiting for ports.http.open",
          promise: messageQueue.next(),
        });
        if (openMessage.type !== "ports.http.open") {
          throw new Error("Expected ports.http.open message.");
        }

        await expect(
          withTimeout({
            label: "waiting for request body chunk",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "ports.http.body.chunk",
          streamId: openMessage.streamId,
          direction: "request",
          bytes: Buffer.from("hello from the browser", "utf8").toString("base64"),
          encoding: "base64",
        });
        await expect(
          withTimeout({
            label: "waiting for request body end",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "ports.http.body.end",
          streamId: openMessage.streamId,
          direction: "request",
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.http.response.start",
            streamId: openMessage.streamId,
            status: 204,
            headers: {},
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.http.body.end",
            streamId: openMessage.streamId,
            direction: "response",
          }),
        );

        const response = await withTimeout({
          label: "waiting for browser response",
          promise: responsePromise,
        });
        expect(response.status).toBe(204);
        expect(response.body).toBe("");
      } finally {
        messageQueue.close();
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

    await expectUnauthorizedPortAccess({
      env,
      host,
      cookie: null,
    });
    await expectUnauthorizedPortAccess({
      env,
      host,
      cookie: createCookieHeader("not-a-valid-session-token"),
    });
    await expectUnauthorizedPortAccess({
      env,
      host,
      cookie: createCookieHeader(expiredSessionToken),
    });
    await expectUnauthorizedPortAccess({
      env,
      host: deriveAccessHost({
        sandboxInstanceId,
        port: 5174,
      }),
      cookie: createCookieHeader(validSessionToken),
    });
  });
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_port_access_http",
    sandboxProfileId: "sbp_integration_new_port_access_http",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_port_access_http",
    source: "webhook",
  });
}

function sendGatewayHttpRequest(input: {
  env: IntegrationTestEnvironment;
  path: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<GatewayHttpResponse> {
  const url = new URL(input.path, input.env.dataPlaneGateway.hostBaseUrl);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: input.method ?? "GET",
        headers: {
          ...input.headers,
          [TestEnvironmentIdHeader]: input.env.id,
        },
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

function createWebSocketMessageQueue(socket: WebSocket): WebSocketMessageQueue {
  const queuedMessages: PortsTransportMessage[] = [];
  const waitingResolvers: Array<(message: PortsTransportMessage) => void> = [];

  const onMessage = (data: RawData, isBinary: boolean): void => {
    if (isBinary) {
      throw new Error("Expected text websocket payload.");
    }

    const message = parseTransportMessage(toBuffer(data).toString("utf8"));
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

      return await new Promise<PortsTransportMessage>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

function parseTransportMessage(input: string): PortsTransportMessage {
  const parsedMessage = parsePortsTransportMessage(input);
  if (parsedMessage === undefined) {
    throw new Error("Expected ports transport message.");
  }

  return parsedMessage;
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

async function expectUnauthorizedPortAccess(input: {
  env: IntegrationTestEnvironment;
  host: string;
  cookie: string | null;
}): Promise<void> {
  const response = await sendGatewayHttpRequest({
    env: input.env,
    path: "/demo/path",
    headers: {
      host: input.host,
      ...(input.cookie === null ? {} : { cookie: input.cookie }),
    },
  });

  expect(response.status).toBe(401);
  expect(response.body).toBe("Invalid or expired Port Access session.");
}

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
