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
import {
  closeWebSocket,
  sendWebSocketMessage,
  waitForWebSocketClose,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const StepTimeoutMs = 5_000;

type UnexpectedResponse = {
  headers: {
    [key: string]: string | string[] | undefined;
  };
  on: (event: "data", listener: (chunk: Buffer) => void) => void;
  once: (event: "end", listener: () => void) => void;
  statusCode?: number;
};

type FailedWebSocketConnectResult = {
  error: unknown;
  responseStatusCode: number | undefined;
};

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

function connectPortAccessWebSocket(input: {
  cookieHeader?: string;
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  origin?: string;
  path: string;
}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${input.fixture.websocketBaseUrl}${input.path}`, {
      autoPong: false,
      handshakeTimeout: StepTimeoutMs,
      headers: {
        host: input.host,
        ...(input.cookieHeader === undefined ? {} : { cookie: input.cookieHeader }),
        ...(input.origin === undefined ? {} : { origin: input.origin }),
      },
    });

    const onOpen = (): void => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onUnexpectedResponse = (_request: unknown, response: UnexpectedResponse): void => {
      cleanup();
      reject(
        Object.assign(new Error("Websocket upgrade failed."), {
          statusCode: response.statusCode,
        }),
      );
    };
    const cleanup = (): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
}

function connectPortAccessWebSocketExpectFailure(input: {
  cookieHeader?: string;
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): Promise<FailedWebSocketConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${input.fixture.websocketBaseUrl}${input.path}`, {
      handshakeTimeout: StepTimeoutMs,
      headers: {
        host: input.host,
        ...(input.cookieHeader === undefined ? {} : { cookie: input.cookieHeader }),
      },
    });

    socket.once("open", () => {
      socket.close();
      reject(new Error("Expected websocket connection to fail but it opened successfully."));
    });

    socket.once("unexpected-response", (_request: unknown, response: UnexpectedResponse) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });
      response.once("end", () => {
        resolve({
          error: new Error(Buffer.concat(chunks).toString("utf8") || "Websocket upgrade failed."),
          responseStatusCode: response.statusCode,
        });
      });
    });

    socket.once("error", (error: Error) => {
      resolve({
        error,
        responseStatusCode: undefined,
      });
    });
  });
}

function waitForWebSocketPong(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onPong = (data: Buffer): void => {
      cleanup();
      resolve(Buffer.from(data));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("pong", onPong);
      socket.off("error", onError);
    };

    socket.once("pong", onPong);
    socket.once("error", onError);
  });
}

describe("port access websocket integration", () => {
  it("upgrades the browser websocket and relays frames, control frames, and upstream closes", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_websocket_success";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_websocket_success",
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
    let accessSocket: WebSocket | undefined;

    try {
      const accessSocketPromise = connectPortAccessWebSocket({
        cookieHeader: createCookieHeader(sessionToken),
        fixture,
        host,
        origin: "https://dashboard.mistle.localhost",
        path: "/socket/echo?mode=full",
      });

      const openMessage = await withTimeout({
        label: "waiting for ports.ws.open",
        promise: messageQueue.next(),
      });
      if (openMessage.type !== "ports.ws.open") {
        throw new Error("Expected ports.ws.open message.");
      }

      expect(openMessage).toEqual({
        type: "ports.ws.open",
        streamId: expect.any(Number),
        target: {
          kind: "port",
          port,
        },
        upstreamProtocol: "http",
        request: {
          path: "/socket/echo",
          query: "mode=full",
          headers: expect.objectContaining({
            connection: ["Upgrade"],
            host: [`127.0.0.1:${String(port)}`],
            origin: [`http://127.0.0.1:${String(port)}`],
            upgrade: ["websocket"],
            "x-forwarded-host": [host],
            "x-forwarded-port": ["80"],
            "x-forwarded-proto": ["http"],
          }),
        },
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.ws.accept",
          streamId: openMessage.streamId,
          headers: {
            "sec-websocket-accept": ["accept-value"],
          },
        }),
      );

      accessSocket = await withTimeout({
        label: "waiting for browser websocket upgrade",
        promise: accessSocketPromise,
      });

      accessSocket.send("hello from browser");
      const requestTextFrame = await withTimeout({
        label: "waiting for request text frame",
        promise: messageQueue.next(),
      });
      expect(requestTextFrame).toEqual({
        type: "ports.ws.frame",
        streamId: openMessage.streamId,
        direction: "request",
        opcode: "text",
        bytes: Buffer.from("hello from browser", "utf8").toString("base64"),
        encoding: "base64",
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.ws.frame",
          streamId: openMessage.streamId,
          direction: "response",
          opcode: "text",
          bytes: Buffer.from("hello from sandboxd", "utf8").toString("base64"),
          encoding: "base64",
        }),
      );
      await expect(
        withTimeout({
          label: "waiting for browser response text frame",
          promise: waitForWebSocketMessage(accessSocket),
        }),
      ).resolves.toEqual({
        data: "hello from sandboxd",
        isBinary: false,
      });

      accessSocket.ping(Buffer.from("browser-ping", "utf8"));
      const requestPingFrame = await withTimeout({
        label: "waiting for request ping frame",
        promise: messageQueue.next(),
      });
      expect(requestPingFrame).toEqual({
        type: "ports.ws.frame",
        streamId: openMessage.streamId,
        direction: "request",
        opcode: "ping",
        bytes: Buffer.from("browser-ping", "utf8").toString("base64"),
        encoding: "base64",
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.ws.frame",
          streamId: openMessage.streamId,
          direction: "response",
          opcode: "pong",
          bytes: Buffer.from("browser-ping", "utf8").toString("base64"),
          encoding: "base64",
        }),
      );
      await expect(
        withTimeout({
          label: "waiting for browser pong",
          promise: waitForWebSocketPong(accessSocket),
        }),
      ).resolves.toEqual(Buffer.from("browser-ping", "utf8"));

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.ws.close",
          streamId: openMessage.streamId,
          direction: "response",
          code: 1000,
          reason: "done",
        }),
      );
      await expect(
        withTimeout({
          label: "waiting for browser websocket close",
          promise: waitForWebSocketClose(accessSocket),
        }),
      ).resolves.toEqual({
        code: 1000,
        reason: "done",
      });
      accessSocket = undefined;
    } finally {
      messageQueue.close();
      await closeWebSocketIfOpen(accessSocket);
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("forwards browser close frames as ports.ws.close", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_port_access_websocket_browser_close";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_websocket_browser_close",
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
    let accessSocket: WebSocket | undefined;

    try {
      const accessSocketPromise = connectPortAccessWebSocket({
        cookieHeader: createCookieHeader(sessionToken),
        fixture,
        host,
        path: "/socket/close",
      });

      const openMessage = await withTimeout({
        label: "waiting for ports.ws.open",
        promise: messageQueue.next(),
      });
      if (openMessage.type !== "ports.ws.open") {
        throw new Error("Expected ports.ws.open message.");
      }

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.ws.accept",
          streamId: openMessage.streamId,
          headers: {},
        }),
      );

      accessSocket = await withTimeout({
        label: "waiting for browser websocket upgrade",
        promise: accessSocketPromise,
      });

      const browserClosePromise = waitForWebSocketClose(accessSocket);
      accessSocket.close(1000, "browser-done");
      const closeMessage = await withTimeout({
        label: "waiting for request close frame",
        promise: messageQueue.next(),
      });
      expect(closeMessage).toEqual({
        type: "ports.ws.close",
        streamId: openMessage.streamId,
        direction: "request",
        code: 1000,
        reason: "browser-done",
      });

      await expect(
        withTimeout({
          label: "waiting for browser websocket close",
          promise: browserClosePromise,
        }),
      ).resolves.toEqual({
        code: 1000,
        reason: "browser-done",
      });
      accessSocket = undefined;
    } finally {
      messageQueue.close();
      await closeWebSocketIfOpen(accessSocket);
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("closes accepted port access websockets when the bootstrap disconnects without any active HTTP streams", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_websocket_bootstrap_disconnect";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_websocket_bootstrap_disconnect",
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
    let accessSocket: WebSocket | undefined;

    try {
      const accessSocketPromise = connectPortAccessWebSocket({
        cookieHeader: createCookieHeader(sessionToken),
        fixture,
        host,
        path: "/socket/disconnect",
      });

      const openMessage = await withTimeout({
        label: "waiting for ports.ws.open",
        promise: messageQueue.next(),
      });
      if (openMessage.type !== "ports.ws.open") {
        throw new Error("Expected ports.ws.open message.");
      }

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.ws.accept",
          streamId: openMessage.streamId,
          headers: {},
        }),
      );

      accessSocket = await withTimeout({
        label: "waiting for browser websocket upgrade",
        promise: accessSocketPromise,
      });

      const browserClosePromise = waitForWebSocketClose(accessSocket);
      await closeWebSocket(bootstrapSocket);

      await expect(
        withTimeout({
          label: "waiting for browser websocket close after bootstrap disconnect",
          promise: browserClosePromise,
        }),
      ).resolves.toEqual({
        code: 1011,
        reason: "Sandbox bootstrap tunnel disconnected.",
      });
      accessSocket = undefined;
    } finally {
      messageQueue.close();
      await closeWebSocketIfOpen(accessSocket);
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie is missing", async ({
    fixture,
  }) => {
    const result = await connectPortAccessWebSocketExpectFailure({
      fixture,
      host: deriveAccessHost({
        fixture,
        sandboxInstanceId: "sbi_port_access_websocket_missing_cookie",
        port: 5173,
      }),
      path: "/socket/auth",
    });

    expect(result.responseStatusCode).toBe(401);
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie is invalid", async ({
    fixture,
  }) => {
    const result = await connectPortAccessWebSocketExpectFailure({
      cookieHeader: createCookieHeader("not-a-valid-session-token"),
      fixture,
      host: deriveAccessHost({
        fixture,
        sandboxInstanceId: "sbi_port_access_websocket_invalid_cookie",
        port: 5173,
      }),
      path: "/socket/auth",
    });

    expect(result.responseStatusCode).toBe(401);
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
      fixture,
      sandboxInstanceId,
      port,
      host,
      clock: expiredClock,
    });

    const result = await connectPortAccessWebSocketExpectFailure({
      cookieHeader: createCookieHeader(sessionToken),
      fixture,
      host,
      path: "/socket/auth",
    });

    expect(result.responseStatusCode).toBe(401);
  });

  it("rejects the websocket upgrade with 401 when the port access session cookie host binding does not match", async ({
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
      sandboxInstanceId,
      port,
      host,
    });

    const result = await connectPortAccessWebSocketExpectFailure({
      cookieHeader: createCookieHeader(sessionToken),
      fixture,
      host: deriveAccessHost({
        fixture,
        sandboxInstanceId,
        port: 5174,
      }),
      path: "/socket/auth",
    });

    expect(result.responseStatusCode).toBe(401);
  });
});
