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
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import { createOpenCodeSessionClient } from "./client.js";

type OpenCodeProxyRequest = {
  body?: unknown;
  id: string;
  method: string;
  path: string;
};

type OpenCodeProxyFrame =
  | {
      body: string;
      headers: Record<string, string>;
      id: string;
      status: number;
      type: "response";
    }
  | {
      data: string;
      event?: string;
      id: string;
      type: "sse";
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
  close(): Promise<void>;
  nextRequest(): Promise<ObservedOpenCodeProxyRequest>;
  readonly receivedControlMessages: readonly StreamControlMessage[];
  sendJsonResponse(input: { body: unknown; request: ObservedOpenCodeProxyRequest }): void;
  sendNoContentResponse(input: { request: ObservedOpenCodeProxyRequest }): void;
  sendSseOpenResponse(input: { request: ObservedOpenCodeProxyRequest }): void;
  sendFrame(input: { frame: OpenCodeProxyFrame; streamId: number }): void;
  readonly url: string;
};

const PollIntervalMs = 10;
const openServers = new Set<OpenCodeProxyTransportServer>();

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolveFn: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
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
    throw new Error("Expected websocket text payload kind.");
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
              streamId: controlMessage.streamId,
              type: "stream.open.ok",
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
    sendFrame: (input) => {
      if (socket === null) {
        throw new Error("OpenCode proxy transport server has no connected socket.");
      }
      sendTextFrame(socket, {
        payload: input.frame,
        streamId: input.streamId,
      });
    },
    sendJsonResponse: (input) => {
      transportServer.sendFrame({
        streamId: input.request.streamId,
        frame: {
          body: JSON.stringify(input.body),
          headers: {
            "content-type": "application/json",
          },
          id: input.request.request.id,
          status: 200,
          type: "response",
        },
      });
    },
    sendNoContentResponse: (input) => {
      transportServer.sendFrame({
        streamId: input.request.streamId,
        frame: {
          body: "",
          headers: {},
          id: input.request.request.id,
          status: 204,
          type: "response",
        },
      });
    },
    sendSseOpenResponse: (input) => {
      transportServer.sendFrame({
        streamId: input.request.streamId,
        frame: {
          body: "",
          headers: {
            "content-type": "text/event-stream",
          },
          id: input.request.request.id,
          status: 200,
          type: "response",
        },
      });
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
  openServers.add(transportServer);
  return transportServer;
}

async function createConnectedClient(server: OpenCodeProxyTransportServer) {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  await transport.connect({
    connectionUrl: server.url,
  });
  return createOpenCodeSessionClient({ transport });
}

afterEach(async () => {
  await Promise.all([...openServers].map(async (server) => await server.close()));
  openServers.clear();
});

describe("createOpenCodeSessionClient", () => {
  it("maps health through the OpenCode proxy fetch adapter", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const client = await createConnectedClient(server);

    const healthPromise = client.health();
    const request = await server.nextRequest();
    server.sendJsonResponse({
      request,
      body: {
        healthy: true,
        version: "1.14.41",
      },
    });

    await expect(healthPromise).resolves.toEqual({
      healthy: true,
      version: "1.14.41",
    });
    expect(request.request).toMatchObject({
      method: "GET",
      path: "/global/health",
    });
  });

  it("maps session create, get, and message listing", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const client = await createConnectedClient(server);

    const createdPromise = client.createSession({
      title: "Dashboard session",
    });
    const createRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: createRequest,
      body: createSessionResponse("ses_test", "Dashboard session"),
    });
    await expect(createdPromise).resolves.toMatchObject({
      id: "ses_test",
      title: "Dashboard session",
    });
    expect(createRequest.request).toMatchObject({
      method: "POST",
      path: "/session",
      body: {
        title: "Dashboard session",
      },
    });

    const getPromise = client.getSession({
      sessionId: "ses_test",
    });
    const getRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: getRequest,
      body: createSessionResponse("ses_test", "Dashboard session"),
    });
    await expect(getPromise).resolves.toMatchObject({
      id: "ses_test",
    });
    expect(getRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test",
    });

    const sessionsPromise = client.listSessions({
      directory: "/workspace/repo",
      limit: 1,
    });
    const sessionsRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: sessionsRequest,
      body: [createSessionResponse("ses_recent", "Recent session")],
    });
    await expect(sessionsPromise).resolves.toMatchObject([
      {
        id: "ses_recent",
        title: "Recent session",
      },
    ]);
    expect(sessionsRequest.request).toMatchObject({
      method: "GET",
      path: "/session?directory=%2Fworkspace%2Frepo&limit=1",
    });

    const messagesPromise = client.listMessages({
      sessionId: "ses_test",
    });
    const messagesRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: messagesRequest,
      body: [
        {
          info: {
            id: "msg_user",
            role: "user",
            sessionID: "ses_test",
            time: {
              created: 1,
            },
          },
          parts: [
            {
              id: "part_user",
              messageID: "msg_user",
              sessionID: "ses_test",
              text: "hello",
              type: "text",
            },
          ],
        },
      ],
    });
    await expect(messagesPromise).resolves.toHaveLength(1);
    expect(messagesRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test/message",
    });
  });

  it("uses promptAsync for prompts and abort endpoint for interrupts", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const client = await createConnectedClient(server);

    const promptPromise = client.sendPrompt({
      sessionId: "ses_test",
      parts: [
        {
          text: "Implement this",
          type: "text",
        },
      ],
    });
    const promptRequest = await server.nextRequest();
    server.sendNoContentResponse({
      request: promptRequest,
    });
    await expect(promptPromise).resolves.toBeUndefined();
    expect(promptRequest.request).toMatchObject({
      method: "POST",
      path: "/session/ses_test/prompt_async",
      body: {
        parts: [
          {
            text: "Implement this",
            type: "text",
          },
        ],
      },
    });

    const abortPromise = client.abortSession({
      sessionId: "ses_test",
    });
    const abortRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: abortRequest,
      body: true,
    });
    await expect(abortPromise).resolves.toBeUndefined();
    expect(abortRequest.request).toMatchObject({
      method: "POST",
      path: "/session/ses_test/abort",
    });
  });

  it("responds to OpenCode session permission requests", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const client = await createConnectedClient(server);

    const responsePromise = client.respondToPermission({
      requestId: "perm_test",
      response: "once",
    });
    const request = await server.nextRequest();
    server.sendJsonResponse({
      request,
      body: true,
    });

    await expect(responsePromise).resolves.toBeUndefined();
    expect(request.request).toMatchObject({
      method: "POST",
      path: "/permission/perm_test/reply",
      body: {
        reply: "once",
      },
    });
  });

  it("subscribes to events and closes the underlying sandbox stream", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const client = await createConnectedClient(server);

    const subscription = await client.subscribeEvents();
    const iterator = subscription[Symbol.asyncIterator]();
    const eventPromise = iterator.next();
    const request = await server.nextRequest();
    server.sendSseOpenResponse({ request });
    server.sendFrame({
      streamId: request.streamId,
      frame: {
        data: JSON.stringify({
          type: "session.updated",
        }),
        event: "message",
        id: request.request.id,
        type: "sse",
      },
    });

    await expect(eventPromise).resolves.toMatchObject({
      done: false,
      value: {
        type: "session.updated",
      },
    });
    await subscription.close();
    await waitForCondition({
      description: "stream.close control message",
      evaluate: () =>
        server.receivedControlMessages.some((message) => {
          return message.type === "stream.close" && message.streamId === request.streamId;
        }),
      timeoutMs: 1_000,
    });
  });

  it("throws explicit errors for missing required inputs", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const client = await createConnectedClient(server);

    await expect(
      client.sendPrompt({
        sessionId: "",
        parts: [
          {
            text: "hello",
            type: "text",
          },
        ],
      }),
    ).rejects.toThrow("OpenCode session id must not be empty.");
    await expect(
      client.sendPrompt({
        sessionId: "ses_test",
        parts: [],
      }),
    ).rejects.toThrow("OpenCode prompt parts must not be empty.");
    await expect(
      client.respondToPermission({
        requestId: "",
        response: "reject",
      }),
    ).rejects.toThrow("OpenCode permission request id must not be empty.");
  });
});

function createSessionResponse(id: string, title: string) {
  return {
    directory: "/workspace",
    id,
    projectID: "project",
    slug: id,
    time: {
      created: 1,
      updated: 2,
    },
    title,
    version: "1.14.41",
  };
}
