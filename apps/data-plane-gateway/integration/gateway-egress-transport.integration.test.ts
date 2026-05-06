/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  parseEgressTransportMessage,
  type EgressTransportMessage,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket, { type RawData } from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const StepTimeoutMs = 5_000;
const TestTimeoutMs = 40_000;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

type ReceivedHttpRequest = {
  body: string;
  headers: IncomingMessage["headers"];
  method: string;
  url: string;
};

type SimulatedHttpUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
};

type SimulatedUpgradeUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
};

type SimulatedStreamingHttpUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
  nextResponseClosed: () => Promise<void>;
};

type WebSocketMessageQueue = {
  close: () => void;
  next: () => Promise<EgressTransportMessage>;
};

describe.concurrent("gateway egress transport integration", () => {
  it(
    "forwards unmatched HTTP requests upstream without adding Mistle credential headers",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedHttpUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/demo/path?color=blue", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_http",
            streamId: 11,
            request: {
              method: "POST",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              query: upstreamUrl.search.slice(1),
              headers: {
                "content-type": ["text/plain; charset=utf-8"],
                "x-request-marker": ["egress-http"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 11,
            bytes: Buffer.from("hello from sandboxd", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 11,
          }),
        );

        const request = await withTimeout({
          label: "waiting for simulated HTTP upstream request",
          promise: upstream.nextRequest(),
        });
        expect(request).toEqual({
          body: "hello from sandboxd",
          headers: expect.objectContaining({
            "content-type": "text/plain; charset=utf-8",
            "x-request-marker": "egress-http",
          }),
          method: "POST",
          url: "/demo/path?color=blue",
        });
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers["x-mistle-egress-grant"]).toBeUndefined();

        await expect(
          withTimeout({
            label: "waiting for egress HTTP response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 11,
          status: 202,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
            "x-upstream-marker": ["simulated-http"],
          }),
        });
        await expect(
          withTimeout({
            label: "waiting for egress HTTP response body chunk",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.chunk",
          streamId: 11,
          bytes: Buffer.from("hello from upstream", "utf8").toString("base64"),
          encoding: "base64",
        });
        await expect(
          withTimeout({
            label: "waiting for egress HTTP response body end",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.end",
          streamId: 11,
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "forwards unmatched HTTP upgrades as post-upgrade byte streams",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedUpgradeUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/socket", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_upgrade",
            streamId: 12,
            request: {
              method: "GET",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              headers: {
                connection: ["Upgrade"],
                upgrade: ["websocket"],
                "sec-websocket-key": ["dGhlIHNhbXBsZSBub25jZQ=="],
                "sec-websocket-version": ["13"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 12,
          }),
        );

        const request = await withTimeout({
          label: "waiting for simulated upgrade upstream request",
          promise: upstream.nextRequest(),
        });
        expect(request.method).toBe("GET");
        expect(request.url).toBe("/socket");
        expect(request.headers.upgrade).toBe("websocket");

        await expect(
          withTimeout({
            label: "waiting for egress upgrade response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 12,
          status: 101,
          headers: expect.objectContaining({
            connection: ["Upgrade"],
            upgrade: ["websocket"],
          }),
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.tcp.data",
            streamId: 12,
            direction: "request",
            bytes: Buffer.from("ping", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await expect(
          withTimeout({
            label: "waiting for egress upgraded response bytes",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.tcp.data",
          streamId: 12,
          direction: "response",
          bytes: Buffer.from("echo:ping", "utf8").toString("base64"),
          encoding: "base64",
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.tcp.close",
            streamId: 12,
            direction: "request",
          }),
        );
        await expect(
          withTimeout({
            label: "waiting for egress upgraded response close",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.tcp.close",
          streamId: 12,
          direction: "response",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes the upstream HTTP response when sandboxd cancels an egress stream",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedStreamingHttpUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/stream", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_cancel",
            streamId: 13,
            request: {
              method: "GET",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              headers: {},
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 13,
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for simulated streaming HTTP upstream request",
            promise: upstream.nextRequest(),
          }),
        ).resolves.toEqual({
          body: "",
          headers: expect.any(Object),
          method: "GET",
          url: "/stream",
        });
        await expect(
          withTimeout({
            label: "waiting for streaming HTTP response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 13,
          status: 200,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
          }),
        });
        await expect(
          withTimeout({
            label: "waiting for streaming HTTP response body chunk",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.chunk",
          streamId: 13,
          bytes: Buffer.from("stream-start", "utf8").toString("base64"),
          encoding: "base64",
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.stream.cancel",
            streamId: 13,
            reason: "caller stopped waiting",
          }),
        );

        await withTimeout({
          label: "waiting for simulated streaming HTTP upstream response to close",
          promise: upstream.nextResponseClosed(),
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "returns a stream error for gateway-owned egress frames sent by sandboxd",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.response.start",
            streamId: 14,
            status: 200,
            headers: {},
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for forbidden egress frame error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 14,
          code: "forbidden_tunnel_state",
          message:
            "Bootstrap tunnel cannot send gateway-owned egress message 'egress.http.response.start'.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "returns a stream error for malformed egress frames with a stream id",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 15,
            bytes: "not-checked-here",
            encoding: "plain",
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for malformed egress frame error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 15,
          code: "malformed_frame",
          message: "Malformed egress transport message 'egress.http.request.body.chunk'.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_gateway_egress_transport",
    sandboxProfileId: "sbp_integration_gateway_egress_transport",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_gateway_egress_transport",
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

async function startSimulatedHttpUpstream(): Promise<SimulatedHttpUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const server = createServer((request, response) => {
    handleSimulatedHttpRequest({
      receivedRequests,
      request,
      response,
      waitingResolvers,
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

async function startSimulatedUpgradeUpstream(): Promise<SimulatedUpgradeUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    const receivedRequest = {
      body: "",
      headers: request.headers,
      method: request.method ?? "",
      url: request.url ?? "",
    };
    const resolver = waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      receivedRequests.push(receivedRequest);
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "",
        "",
      ].join("\r\n"),
    );
    socket.on("data", (chunk: Buffer) => {
      socket.write(Buffer.concat([Buffer.from("echo:", "utf8"), chunk]));
    });
    socket.on("end", () => {
      socket.end();
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

async function startSimulatedStreamingHttpUpstream(): Promise<SimulatedStreamingHttpUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingRequestResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const waitingCloseResolvers: Array<() => void> = [];
  let closedResponseCount = 0;
  const sockets = new Set<Duplex>();
  const server = createServer((request, response) => {
    sockets.add(request.socket);
    request.socket.on("close", () => {
      sockets.delete(request.socket);
    });
    response.on("close", () => {
      const resolver = waitingCloseResolvers.shift();
      if (resolver !== undefined) {
        resolver();
        return;
      }

      closedResponseCount += 1;
    });
    handleSimulatedStreamingHttpRequest({
      receivedRequests,
      request,
      response,
      waitingResolvers: waitingRequestResolvers,
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingRequestResolvers.push(resolve);
      });
    },
    nextResponseClosed: async () => {
      if (closedResponseCount > 0) {
        closedResponseCount -= 1;
        return;
      }

      await new Promise<void>((resolve) => {
        waitingCloseResolvers.push(resolve);
      });
    },
  };
}

function handleSimulatedHttpRequest(input: {
  receivedRequests: ReceivedHttpRequest[];
  request: IncomingMessage;
  response: ServerResponse;
  waitingResolvers: Array<(request: ReceivedHttpRequest) => void>;
}): void {
  const chunks: Buffer[] = [];
  input.request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  input.request.on("end", () => {
    const receivedRequest = {
      body: Buffer.concat(chunks).toString("utf8"),
      headers: input.request.headers,
      method: input.request.method ?? "",
      url: input.request.url ?? "",
    };
    const resolver = input.waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      input.receivedRequests.push(receivedRequest);
    }
    input.response.writeHead(202, {
      "content-type": "text/plain; charset=utf-8",
      "x-upstream-marker": "simulated-http",
    });
    input.response.end("hello from upstream");
  });
}

function handleSimulatedStreamingHttpRequest(input: {
  receivedRequests: ReceivedHttpRequest[];
  request: IncomingMessage;
  response: ServerResponse;
  waitingResolvers: Array<(request: ReceivedHttpRequest) => void>;
}): void {
  const chunks: Buffer[] = [];
  input.request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  input.request.on("end", () => {
    const receivedRequest = {
      body: Buffer.concat(chunks).toString("utf8"),
      headers: input.request.headers,
      method: input.request.method ?? "",
      url: input.request.url ?? "",
    };
    const resolver = input.waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      input.receivedRequests.push(receivedRequest);
    }
    input.response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
    });
    input.response.write("stream-start");
  });
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

function createWebSocketMessageQueue(socket: WebSocket): WebSocketMessageQueue {
  const queuedMessages: EgressTransportMessage[] = [];
  const waitingResolvers: Array<(message: EgressTransportMessage) => void> = [];

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

      return await new Promise<EgressTransportMessage>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

function parseTransportMessage(input: string): EgressTransportMessage {
  const parsedMessage = parseEgressTransportMessage(input);
  if (parsedMessage === undefined) {
    throw new Error("Expected egress transport message.");
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

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected simulated upstream to listen on a TCP port."));
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

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
