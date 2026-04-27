/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { derivePortAccessHost } from "@mistle/port-access-auth";
import {
  parsePortsTransportMessage,
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

type WebSocketMessageQueue = {
  close: () => void;
  next: () => Promise<PortsTransportMessage>;
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
      baseDomain: input.fixture.config.sandbox.publish.baseDomain,
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
      cookieSigningSecret: input.fixture.config.sandbox.publish.session.cookieSigningSecret,
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

      return new Promise<PortsTransportMessage>((resolve) => {
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

async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
    await closeWebSocket(socket);
  }
}

async function sendRuntimeHttpRequest(input: {
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
        method: input.method,
        headers: input.headers,
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

describe("port access http integration", () => {
  it("forwards browser HTTP request and response over the ports.http tunnel transport", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_http_success";
    const port = 5173;
    const testId = "port_access_http_success";
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId,
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
    const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

    try {
      const responsePromise = fixture.runtime.request("/demo/path?color=blue&mode=full", {
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
      const httpOpen = openMessage;

      expect(httpOpen).toEqual({
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
      expect(httpOpen.request.headers.cookie).toEqual(["theme=dark"]);
      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.http.response.start",
          streamId: httpOpen.streamId,
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
          streamId: httpOpen.streamId,
          direction: "response",
          bytes: Buffer.from("hello from sandboxd", "utf8").toString("base64"),
          encoding: "base64",
        }),
      );
      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.http.body.end",
          streamId: httpOpen.streamId,
          direction: "response",
        }),
      );

      const response = await withTimeout({
        label: "waiting for browser response",
        promise: responsePromise,
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
      await expect(
        withTimeout({
          label: "waiting for browser response body",
          promise: response.text(),
        }),
      ).resolves.toBe("hello from sandboxd");
    } finally {
      messageQueue.close();
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("forwards browser request bodies as ports.http.body.chunk messages", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_port_access_http_request_body";
    const port = 5173;
    const testId = "port_access_http_request_body";
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId,
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
    const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

    try {
      const responsePromise = sendRuntimeHttpRequest({
        fixture,
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

      const requestBodyChunk = await withTimeout({
        label: "waiting for request body chunk",
        promise: messageQueue.next(),
      });
      expect(requestBodyChunk).toEqual({
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
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("returns 401 when the port access session cookie is missing", async ({ fixture }) => {
    const host = deriveAccessHost({
      fixture,
      sandboxInstanceId: "sbi_port_access_http_missing_cookie",
      port: 5173,
    });

    const response = await fixture.runtime.request("/demo/path", {
      headers: {
        host,
      },
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid or expired Port Access session.");
  });

  it("returns 401 when the port access session cookie is invalid", async ({ fixture }) => {
    const host = deriveAccessHost({
      fixture,
      sandboxInstanceId: "sbi_port_access_http_invalid_cookie",
      port: 5173,
    });

    const response = await fixture.runtime.request("/demo/path", {
      headers: {
        cookie: createCookieHeader("not-a-valid-session-token"),
        host,
      },
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid or expired Port Access session.");
  });

  it("returns 401 when the port access session cookie is expired", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_port_access_http_expired_cookie";
    const port = 5173;
    const host = deriveAccessHost({
      fixture,
      sandboxInstanceId,
      port,
    });
    const expiredClock = createMutableClock(1_000);
    const sessionToken = await mintSessionToken({
      fixture,
      sandboxInstanceId,
      port,
      host,
      clock: expiredClock,
    });

    const response = await fixture.runtime.request("/demo/path", {
      headers: {
        cookie: createCookieHeader(sessionToken),
        host,
      },
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid or expired Port Access session.");
  });

  it("returns 401 when the port access session cookie host binding does not match", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_http_binding_mismatch";
    const port = 5173;
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
    const mismatchedHost = deriveAccessHost({
      fixture,
      sandboxInstanceId,
      port: 5174,
    });

    const response = await fixture.runtime.request("/demo/path", {
      headers: {
        cookie: createCookieHeader(sessionToken),
        host: mismatchedHost,
      },
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid or expired Port Access session.");
  });
});
