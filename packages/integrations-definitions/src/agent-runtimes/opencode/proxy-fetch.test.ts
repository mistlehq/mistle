import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
  type StreamControlMessage,
  type StreamDataFrame,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import { createOpenCodeProxyFetch } from "./proxy-fetch.js";

type OpenCodeProxyRequest = {
  id: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type OpenCodeProxyFrame =
  | {
      id: string;
      type: "response";
      status: number;
      headers: Record<string, string>;
      body: string;
    }
  | {
      id: string;
      type: "sse";
      event?: string;
      data: string;
    }
  | {
      id: string;
      type: "complete";
    };

type ObservedOpenCodeProxyRequest = {
  request: OpenCodeProxyRequest;
  streamId: number;
};

type OpenCodeProxyTransportServer = {
  close: () => Promise<void>;
  nextRequest: () => Promise<ObservedOpenCodeProxyRequest>;
  receivedControlMessages: readonly StreamControlMessage[];
  resetStream: (input: { code: string; message: string; streamId: number }) => void;
  sendFrame: (input: { frame: OpenCodeProxyFrame; streamId: number }) => void;
  url: string;
};

const PollIntervalMs = 10;
const openServers = new Set<OpenCodeProxyTransportServer>();

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
  };
}

function toUint8Array(data: RawData): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
}

function toText(data: RawData): string {
  return new TextDecoder().decode(toUint8Array(data));
}

function decodeTextDataFrame(data: RawData): StreamDataFrame {
  const frame = decodeDataFrame(toUint8Array(data));
  if (frame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(frame.payloadKind)}.`,
    );
  }
  return frame;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object.");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function parseOptionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected optional string record to be an object.");
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => [key, String(recordValue)]),
  );
}

function parseOpenCodeProxyRequest(frame: StreamDataFrame): ObservedOpenCodeProxyRequest {
  const payload = parseJsonObject(new TextDecoder().decode(frame.payload));
  if (typeof payload.id !== "string") {
    throw new Error("Expected OpenCode proxy request id.");
  }
  if (typeof payload.method !== "string") {
    throw new Error("Expected OpenCode proxy request method.");
  }
  if (typeof payload.path !== "string") {
    throw new Error("Expected OpenCode proxy request path.");
  }

  const request: OpenCodeProxyRequest = {
    id: payload.id,
    method: payload.method,
    path: payload.path,
  };
  if ("headers" in payload) {
    const headers = parseOptionalStringRecord(payload.headers);
    if (headers !== undefined) {
      request.headers = headers;
    }
  }
  if ("body" in payload) {
    request.body = payload.body;
  }

  return {
    request,
    streamId: frame.streamId,
  };
}

function sendTextFrame(socket: WebSocket, input: { payload: unknown; streamId: number }): void {
  socket.send(
    encodeDataFrame({
      streamId: input.streamId,
      payloadKind: PayloadKindWebSocketText,
      payload: new TextEncoder().encode(JSON.stringify(input.payload)),
    }),
  );
}

async function waitForCondition(input: {
  description: string;
  evaluate: () => boolean;
  timeoutMs: number;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;
  while (Date.now() < deadlineEpochMs) {
    if (input.evaluate()) {
      return;
    }
    await systemSleeper.sleep(PollIntervalMs);
  }
  throw new Error(`Timed out waiting for ${input.description}.`);
}

async function startOpenCodeProxyTransportServer(): Promise<OpenCodeProxyTransportServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  const queuedRequests: ObservedOpenCodeProxyRequest[] = [];
  const pendingRequestResolvers: Array<(value: ObservedOpenCodeProxyRequest) => void> = [];
  const receivedControlMessages: StreamControlMessage[] = [];
  let socket: WebSocket | null = null;

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (error) => reject(error));
  });

  server.on("connection", (connectedSocket) => {
    socket = connectedSocket;

    connectedSocket.on("message", (payload, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(payload));
        if (controlMessage === undefined) {
          return;
        }

        receivedControlMessages.push(controlMessage);
        if (controlMessage.type === "stream.open") {
          connectedSocket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId: controlMessage.streamId,
            }),
          );
        }
        return;
      }

      const request = parseOpenCodeProxyRequest(decodeTextDataFrame(payload));
      const pendingResolver = pendingRequestResolvers.shift();
      if (pendingResolver === undefined) {
        queuedRequests.push(request);
        return;
      }
      pendingResolver(request);
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete address.");
  }

  const transportServer: OpenCodeProxyTransportServer = {
    close: async () => {
      socket?.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error == null) {
            resolve();
            return;
          }
          reject(error);
        });
      });
    },
    nextRequest: async () => {
      const queuedRequest = queuedRequests.shift();
      if (queuedRequest !== undefined) {
        return queuedRequest;
      }

      const deferred = createDeferred<ObservedOpenCodeProxyRequest>();
      pendingRequestResolvers.push(deferred.resolve);
      return await deferred.promise;
    },
    receivedControlMessages,
    resetStream: (input) => {
      if (socket === null) {
        throw new Error("OpenCode proxy transport server has no connected socket.");
      }
      socket.send(
        JSON.stringify({
          type: "stream.reset",
          streamId: input.streamId,
          code: input.code,
          message: input.message,
        }),
      );
    },
    sendFrame: (input) => {
      if (socket === null) {
        throw new Error("OpenCode proxy transport server has no connected socket.");
      }
      sendTextFrame(socket, {
        streamId: input.streamId,
        payload: input.frame,
      });
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
  openServers.add(transportServer);
  return transportServer;
}

async function createConnectedTransport(
  server: OpenCodeProxyTransportServer,
): Promise<SandboxSessionTransport> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  await transport.connect({
    connectionUrl: server.url,
  });
  return transport;
}

afterEach(async () => {
  await Promise.all([...openServers].map(async (server) => await server.close()));
  openServers.clear();
});

describe("createOpenCodeProxyFetch", () => {
  it("adapts an SDK HTTP request to the sandboxd OpenCode proxy frame contract", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await createConnectedTransport(server);
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      fetch: createOpenCodeProxyFetch({ transport }),
    });

    const healthResultPromise = client.global.health({
      throwOnError: true,
    });
    const observedRequest = await server.nextRequest();
    server.sendFrame({
      streamId: observedRequest.streamId,
      frame: {
        id: observedRequest.request.id,
        type: "response",
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "ok",
        }),
      },
    });

    await expect(healthResultPromise).resolves.toMatchObject({
      data: {
        status: "ok",
      },
    });
    expect(observedRequest.request).toMatchObject({
      method: "GET",
      path: "/global/health",
    });
  });

  it("reconstructs proxy SSE frames into an SDK-readable event stream", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await createConnectedTransport(server);
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      fetch: createOpenCodeProxyFetch({ transport }),
    });

    const sseErrors: unknown[] = [];
    const eventResult = await client.global.event({
      onSseError: (error) => {
        sseErrors.push(error);
      },
      sseMaxRetryAttempts: 1,
    });
    const nextEventPromise = eventResult.stream.next();
    const observedRequest = await server.nextRequest();
    server.sendFrame({
      streamId: observedRequest.streamId,
      frame: {
        id: observedRequest.request.id,
        type: "response",
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: "",
      },
    });
    server.sendFrame({
      streamId: observedRequest.streamId,
      frame: {
        id: observedRequest.request.id,
        type: "sse",
        event: "message",
        data: JSON.stringify({
          type: "session.updated",
          properties: {
            info: {
              id: "ses_test",
            },
          },
        }),
      },
    });
    server.sendFrame({
      streamId: observedRequest.streamId,
      frame: {
        id: observedRequest.request.id,
        type: "complete",
      },
    });

    await expect(nextEventPromise).resolves.toMatchObject({
      done: false,
      value: {
        type: "session.updated",
      },
    });
    expect(sseErrors).toEqual([]);
    expect(observedRequest.request).toMatchObject({
      method: "GET",
      path: "/global/event",
    });
  });

  it("supports a long-lived event stream while promptAsync uses a separate request", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await createConnectedTransport(server);
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      fetch: createOpenCodeProxyFetch({ transport }),
    });

    const sseErrors: unknown[] = [];
    const eventResult = await client.global.event({
      onSseError: (error) => {
        sseErrors.push(error);
      },
      sseMaxRetryAttempts: 1,
    });
    const nextEventPromise = eventResult.stream.next();
    const eventRequest = await server.nextRequest();
    server.sendFrame({
      streamId: eventRequest.streamId,
      frame: {
        id: eventRequest.request.id,
        type: "response",
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: "",
      },
    });

    const promptResultPromise = client.session.promptAsync({
      sessionID: "ses_test",
      parts: [
        {
          type: "text",
          text: "hello",
        },
      ],
    });
    const promptRequest = await server.nextRequest();
    server.sendFrame({
      streamId: promptRequest.streamId,
      frame: {
        id: promptRequest.request.id,
        type: "response",
        status: 204,
        headers: {},
        body: "",
      },
    });
    server.sendFrame({
      streamId: eventRequest.streamId,
      frame: {
        id: eventRequest.request.id,
        type: "sse",
        event: "message",
        data: JSON.stringify({
          type: "message.updated",
          properties: {
            info: {
              id: "msg_test",
            },
          },
        }),
      },
    });

    await expect(promptResultPromise).resolves.toMatchObject({
      response: {
        status: 204,
      },
    });
    await expect(nextEventPromise).resolves.toMatchObject({
      done: false,
      value: {
        type: "message.updated",
      },
    });
    expect(sseErrors).toEqual([]);
    expect(eventRequest.streamId).not.toBe(promptRequest.streamId);
    expect(promptRequest.request).toMatchObject({
      method: "POST",
      path: "/session/ses_test/prompt_async",
    });
  });

  it("closes the sandbox stream when a fetch request is aborted", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await createConnectedTransport(server);
    const abortController = new AbortController();
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      fetch: createOpenCodeProxyFetch({ transport }),
    });

    const eventResult = await client.global.event({
      signal: abortController.signal,
      sseMaxRetryAttempts: 1,
    });
    const nextEventPromise = eventResult.stream.next();
    const eventRequest = await server.nextRequest();
    server.sendFrame({
      streamId: eventRequest.streamId,
      frame: {
        id: eventRequest.request.id,
        type: "response",
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
        body: "",
      },
    });

    abortController.abort();

    await expect(nextEventPromise).resolves.toMatchObject({
      done: true,
    });
    await waitForCondition({
      description: "stream.close control message",
      evaluate: () =>
        server.receivedControlMessages.some((message) => {
          return message.type === "stream.close" && message.streamId === eventRequest.streamId;
        }),
      timeoutMs: 1_000,
    });
  });

  it("rejects an SDK request when the sandbox stream resets before the OpenCode response", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await createConnectedTransport(server);
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      fetch: createOpenCodeProxyFetch({ transport }),
    });

    const healthResultPromise = client.global.health({
      throwOnError: true,
    });
    const observedRequest = await server.nextRequest();
    server.resetStream({
      streamId: observedRequest.streamId,
      code: "opencode_upstream_reset",
      message: "OpenCode upstream closed before responding.",
    });

    await expect(healthResultPromise).rejects.toThrow(
      "OpenCode proxy stream entered state 'reset': Sandbox session stream reset (opencode_upstream_reset): OpenCode upstream closed before responding.",
    );
  });
});
