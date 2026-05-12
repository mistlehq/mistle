// @vitest-environment jsdom

import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
  type StreamDataFrame,
} from "@mistle/sandbox-session-protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import { useOpenCodeSessionState } from "./use-opencode-session-state.js";

type OpenCodeProxyRequest = {
  body?: unknown;
  id: string;
  method: string;
  path: string;
};

type ObservedOpenCodeProxyRequest = {
  request: OpenCodeProxyRequest;
  streamId: number;
};

type OpenCodeProxyTransportServer = {
  close(): Promise<void>;
  nextRequest(): Promise<ObservedOpenCodeProxyRequest>;
  sendJsonResponse(input: { body: unknown; request: ObservedOpenCodeProxyRequest }): void;
  sendJsonError(input: {
    body: unknown;
    request: ObservedOpenCodeProxyRequest;
    status: number;
  }): void;
  sendNoContentResponse(input: { request: ObservedOpenCodeProxyRequest }): void;
  sendSseOpenResponse(input: { request: ObservedOpenCodeProxyRequest }): void;
  readonly url: string;
};

const openServers = new Set<OpenCodeProxyTransportServer>();
const openTransports = new Set<SandboxSessionTransport>();

async function ensureTransportConnected(): Promise<{
  sandboxInstanceId: string;
  transport: SandboxSessionTransport;
}> {
  throw new Error("This test does not connect to a sandbox transport.");
}

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

async function startOpenCodeProxyTransportServer(): Promise<OpenCodeProxyTransportServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  const queuedRequests: ObservedOpenCodeProxyRequest[] = [];
  const pendingRequestResolvers: Array<(value: ObservedOpenCodeProxyRequest) => void> = [];
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
        if (controlMessage?.type === "stream.open") {
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
    sendJsonResponse: (input) => {
      sendJsonFrame({
        body: input.body,
        request: input.request,
        socket,
        status: 200,
      });
    },
    sendJsonError: (input) => {
      sendJsonFrame({
        body: input.body,
        request: input.request,
        socket,
        status: input.status,
      });
    },
    sendNoContentResponse: (input) => {
      if (socket === null) {
        throw new Error("OpenCode proxy transport server has no connected socket.");
      }
      sendTextFrame(socket, {
        streamId: input.request.streamId,
        payload: {
          body: "",
          headers: {},
          id: input.request.request.id,
          status: 204,
          type: "response",
        },
      });
    },
    sendSseOpenResponse: (input) => {
      if (socket === null) {
        throw new Error("OpenCode proxy transport server has no connected socket.");
      }
      sendTextFrame(socket, {
        streamId: input.request.streamId,
        payload: {
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

function sendJsonFrame(input: {
  body: unknown;
  request: ObservedOpenCodeProxyRequest;
  socket: WebSocket | null;
  status: number;
}): void {
  if (input.socket === null) {
    throw new Error("OpenCode proxy transport server has no connected socket.");
  }
  sendTextFrame(input.socket, {
    streamId: input.request.streamId,
    payload: {
      body: JSON.stringify(input.body),
      headers: {
        "content-type": "application/json",
      },
      id: input.request.request.id,
      status: input.status,
      type: "response",
    },
  });
}

async function connectTransport(
  server: OpenCodeProxyTransportServer,
): Promise<SandboxSessionTransport> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  await transport.connect({
    connectionUrl: server.url,
  });
  openTransports.add(transport);
  return transport;
}

function createSessionResponse(id: string) {
  return {
    directory: "/workspace",
    id,
    projectID: "project",
    slug: id,
    time: {
      created: 1,
      updated: 2,
    },
    title: "Dashboard session",
    version: "1.14.41",
  };
}

function closeTransport(transport: SandboxSessionTransport): void {
  transport.disconnect();
}

async function connectOpenCodeSessionForTest(input: {
  result: { current: ReturnType<typeof useOpenCodeSessionState> };
  sandboxInstanceId: string;
  server: OpenCodeProxyTransportServer;
  sessionId: string;
}): Promise<ObservedOpenCodeProxyRequest> {
  act(() => {
    input.result.current.lifecycle.connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      targetSessionId: input.sessionId,
    });
  });

  const healthRequest = await input.server.nextRequest();
  expect(healthRequest.request).toMatchObject({
    method: "GET",
    path: "/global/health",
  });
  input.server.sendJsonResponse({
    request: healthRequest,
    body: {
      healthy: true,
      version: "1.14.41",
    },
  });

  const getSessionRequest = await input.server.nextRequest();
  expect(getSessionRequest.request).toMatchObject({
    method: "GET",
    path: `/session/${input.sessionId}`,
  });
  input.server.sendJsonResponse({
    request: getSessionRequest,
    body: createSessionResponse(input.sessionId),
  });

  const eventRequest = await input.server.nextRequest();
  input.server.sendSseOpenResponse({
    request: eventRequest,
  });

  const messagesRequest = await input.server.nextRequest();
  expect(messagesRequest.request).toMatchObject({
    method: "GET",
    path: `/session/${input.sessionId}/message`,
  });
  input.server.sendJsonResponse({
    request: messagesRequest,
    body: [],
  });

  const permissionsRequest = await input.server.nextRequest();
  expect(permissionsRequest.request).toMatchObject({
    method: "GET",
    path: "/permission",
  });
  return permissionsRequest;
}

afterEach(async () => {
  for (const transport of openTransports) {
    closeTransport(transport);
  }
  openTransports.clear();
  await Promise.all([...openServers].map(async (server) => await server.close()));
  openServers.clear();
});

describe("useOpenCodeSessionState", () => {
  it("keeps lifecycle callbacks stable across rerenders", () => {
    const { result, rerender } = renderHook(() =>
      useOpenCodeSessionState({
        ensureTransportConnected,
      }),
    );
    const clearLifecycleErrorMessage = result.current.lifecycle.clearLifecycleErrorMessage;
    const connectSession = result.current.lifecycle.connectSession;
    const disconnectSession = result.current.lifecycle.disconnectSession;
    const recoverSession = result.current.lifecycle.recoverSession;

    rerender();

    expect(result.current.lifecycle.clearLifecycleErrorMessage).toBe(clearLifecycleErrorMessage);
    expect(result.current.lifecycle.connectSession).toBe(connectSession);
    expect(result.current.lifecycle.disconnectSession).toBe(disconnectSession);
    expect(result.current.lifecycle.recoverSession).toBe(recoverSession);
  });

  it("does not keep a connected session snapshot after hydration fails", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await connectTransport(server);
    const { result } = renderHook(() =>
      useOpenCodeSessionState({
        ensureTransportConnected: async () => {
          return {
            sandboxInstanceId: "sbi_123",
            transport,
          };
        },
      }),
    );

    const permissionsRequest = await connectOpenCodeSessionForTest({
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_test",
    });
    server.sendJsonError({
      request: permissionsRequest,
      status: 500,
      body: {
        message: "permission listing failed",
      },
    });

    await waitFor(() => {
      expect(result.current.lifecycle.lifecycleErrorMessage).not.toBeNull();
    });
    expect(result.current.lifecycle.sessionConnectionState).toBe("detached");
    expect(result.current.lifecycle.step).toBe("idle");
    expect(result.current.lifecycle.sessionSnapshot).toBeNull();
  });

  it("sends prompts with the selected repository directory", async () => {
    const server = await startOpenCodeProxyTransportServer();
    const transport = await connectTransport(server);
    const { result } = renderHook(() =>
      useOpenCodeSessionState({
        ensureTransportConnected: async () => {
          return {
            sandboxInstanceId: "sbi_123",
            transport,
          };
        },
      }),
    );

    const permissionsRequest = await connectOpenCodeSessionForTest({
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_test",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionConnectionState).toBe("connected");
    });

    let promptPromise: Promise<void> | undefined;
    act(() => {
      promptPromise = result.current.chat.sendPrompt({
        directory: "/workspace/selected-repo",
        submittedPrompt: "Run tests",
      });
    });

    const promptRequest = await server.nextRequest();
    expect(promptRequest.request).toMatchObject({
      method: "POST",
      path: "/session/ses_test/prompt_async?directory=%2Fworkspace%2Fselected-repo",
      body: {
        parts: [
          {
            text: "Run tests",
            type: "text",
          },
        ],
      },
    });
    server.sendNoContentResponse({
      request: promptRequest,
    });
    await expect(promptPromise).resolves.toBeUndefined();
  });
});
