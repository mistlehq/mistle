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

import { usePiSessionState } from "./use-pi-session-state.js";

type PiJsonRpcRequest = {
  id: string;
  method: string;
  params?: unknown;
};

type ObservedPiJsonRpcRequest = {
  request: PiJsonRpcRequest;
  streamId: number;
};

// Local simulator for the Pi JSON-RPC methods used by the production
// createPiSessionClient path in packages/integrations-definitions/src/agent-runtimes/pi/client.ts.
type SimulatedPiJsonRpcTransportServer = {
  close(): Promise<void>;
  nextRequest(): Promise<ObservedPiJsonRpcRequest>;
  sendJsonResponse(input: { request: ObservedPiJsonRpcRequest; result: unknown }): void;
  sendJsonError(input: { code: number; message: string; request: ObservedPiJsonRpcRequest }): void;
  readonly url: string;
};

const openServers = new Set<SimulatedPiJsonRpcTransportServer>();
const openTransports = new Set<SandboxSessionTransport>();

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

function parsePiJsonRpcRequest(frame: StreamDataFrame): ObservedPiJsonRpcRequest {
  const payload = parseJsonObject(new TextDecoder().decode(frame.payload));
  if (typeof payload.id !== "string") {
    throw new Error("Expected Pi JSON-RPC request id.");
  }
  if (typeof payload.method !== "string") {
    throw new Error("Expected Pi JSON-RPC request method.");
  }

  const request: PiJsonRpcRequest = {
    id: payload.id,
    method: payload.method,
  };
  if ("params" in payload) {
    request.params = payload.params;
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

async function startSimulatedPiJsonRpcTransportServer(): Promise<SimulatedPiJsonRpcTransportServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  const queuedRequests: ObservedPiJsonRpcRequest[] = [];
  const pendingRequestResolvers: Array<(value: ObservedPiJsonRpcRequest) => void> = [];
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

      const request = parsePiJsonRpcRequest(decodeTextDataFrame(payload));
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

  const transportServer: SimulatedPiJsonRpcTransportServer = {
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

      const deferred = createDeferred<ObservedPiJsonRpcRequest>();
      pendingRequestResolvers.push(deferred.resolve);
      return await deferred.promise;
    },
    sendJsonResponse: (input) => {
      if (socket === null) {
        throw new Error("Pi JSON-RPC transport server has no connected socket.");
      }
      sendTextFrame(socket, {
        streamId: input.request.streamId,
        payload: {
          id: input.request.request.id,
          jsonrpc: "2.0",
          result: input.result,
        },
      });
    },
    sendJsonError: (input) => {
      if (socket === null) {
        throw new Error("Pi JSON-RPC transport server has no connected socket.");
      }
      sendTextFrame(socket, {
        streamId: input.request.streamId,
        payload: {
          error: {
            code: input.code,
            message: input.message,
          },
          id: input.request.request.id,
          jsonrpc: "2.0",
        },
      });
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
  openServers.add(transportServer);
  return transportServer;
}

async function connectTransport(
  server: SimulatedPiJsonRpcTransportServer,
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

function closeTransport(transport: SandboxSessionTransport): void {
  transport.disconnect();
}

function expectPiRequest(
  request: ObservedPiJsonRpcRequest,
  input: { method: string; params?: unknown },
): void {
  expect(request.request).toEqual({
    id: request.request.id,
    method: input.method,
    ...(input.params === undefined ? {} : { params: input.params }),
  });
}

function sendPiSessionStateResponse(input: {
  request: ObservedPiJsonRpcRequest;
  server: SimulatedPiJsonRpcTransportServer;
  sessionFile: string;
}): void {
  input.server.sendJsonResponse({
    request: input.request,
    result: {
      isStreaming: false,
      isCompacting: false,
      messageCount: 0,
      model: null,
      pendingMessageCount: 0,
      sessionFile: input.sessionFile,
      sessionId: "pi_session_test",
      thinkingLevel: "medium",
    },
  });
}

async function connectPiSessionForTest(input: {
  result: { current: ReturnType<typeof usePiSessionState> };
  sandboxInstanceId: string;
  server: SimulatedPiJsonRpcTransportServer;
  providerConversationId: string;
  sessionFile: string;
}): Promise<void> {
  act(() => {
    input.result.current.lifecycle.connectSession({
      sandboxInstanceId: input.sandboxInstanceId,
      targetConversationId: input.providerConversationId,
    });
  });

  const resumeRequest = await input.server.nextRequest();
  expectPiRequest(resumeRequest, {
    method: "pi/resumeConversation",
    params: {
      providerConversationId: input.providerConversationId,
    },
  });
  input.server.sendJsonResponse({
    request: resumeRequest,
    result: {
      sessionFile: input.sessionFile,
    },
  });

  const stateRequest = await input.server.nextRequest();
  expectPiRequest(stateRequest, {
    method: "pi/getState",
    params: {
      sessionFile: input.sessionFile,
    },
  });
  sendPiSessionStateResponse({
    request: stateRequest,
    server: input.server,
    sessionFile: input.sessionFile,
  });

  const firstBootstrapRequest = await input.server.nextRequest();
  const secondBootstrapRequest = await input.server.nextRequest();
  for (const bootstrapRequest of [firstBootstrapRequest, secondBootstrapRequest]) {
    if (bootstrapRequest.request.method === "pi/getAvailableModels") {
      expectPiRequest(bootstrapRequest, {
        method: "pi/getAvailableModels",
        params: {
          sessionFile: input.sessionFile,
        },
      });
      input.server.sendJsonResponse({
        request: bootstrapRequest,
        result: {
          models: [],
        },
      });
      continue;
    }
    expectPiRequest(bootstrapRequest, {
      method: "pi/getCommands",
      params: {
        sessionFile: input.sessionFile,
      },
    });
    input.server.sendJsonResponse({
      request: bootstrapRequest,
      result: {
        commands: [],
      },
    });
  }

  const messagesRequest = await input.server.nextRequest();
  expectPiRequest(messagesRequest, {
    method: "pi/getMessages",
    params: {
      sessionFile: input.sessionFile,
    },
  });
  input.server.sendJsonResponse({
    request: messagesRequest,
    result: {
      messages: [],
    },
  });

  const firstListRequest = await input.server.nextRequest();
  const secondListRequest = await input.server.nextRequest();
  for (const listRequest of [firstListRequest, secondListRequest]) {
    expect(listRequest.request.method).toBe("pi/listConversations");
    input.server.sendJsonResponse({
      request: listRequest,
      result: {
        conversations: [
          {
            id: input.providerConversationId,
            sessionFile: input.sessionFile,
            cwd: "/workspace",
            title: "Pi test conversation",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: 1,
          },
        ],
        hasMore: false,
      },
    });
  }

  await waitFor(() => {
    expect(input.result.current.lifecycle.sessionConnectionState).toBe("connected");
  });

  const contextUsageRefreshRequest = await input.server.nextRequest();
  expectPiRequest(contextUsageRefreshRequest, {
    method: "pi/getState",
    params: {
      sessionFile: input.sessionFile,
    },
  });
  sendPiSessionStateResponse({
    request: contextUsageRefreshRequest,
    server: input.server,
    sessionFile: input.sessionFile,
  });
}

afterEach(async () => {
  for (const transport of openTransports) {
    closeTransport(transport);
  }
  openTransports.clear();
  await Promise.all([...openServers].map(async (server) => await server.close()));
  openServers.clear();
});

describe("usePiSessionState", () => {
  it("accepts explicit starts only after Pi accepts the prompt", async () => {
    const server = await startSimulatedPiJsonRpcTransportServer();
    const transport = await connectTransport(server);
    const { result } = renderHook(() =>
      usePiSessionState({
        ensureTransportConnected: async () => {
          return {
            sandboxInstanceId: "sbi_123",
            transport,
          };
        },
      }),
    );

    await connectPiSessionForTest({
      providerConversationId: "conversation_test",
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
    });

    let acceptedCount = 0;
    let promptPromise: Promise<void> | undefined;
    act(() => {
      promptPromise = result.current.chat.sendPrompt({
        onAccepted: () => {
          acceptedCount += 1;
        },
        submittedPrompt: "Review the diff",
      });
    });

    const promptRequest = await server.nextRequest();
    expectPiRequest(promptRequest, {
      method: "pi/prompt",
      params: {
        sessionFile: "/root/.pi/agent/sessions/session.jsonl",
        message: "Review the diff",
      },
    });
    expect(acceptedCount).toBe(0);

    server.sendJsonResponse({
      request: promptRequest,
      result: null,
    });

    await expect(promptPromise).resolves.toBeUndefined();
    expect(acceptedCount).toBe(1);
  });

  it("does not accept explicit starts when Pi rejects the prompt", async () => {
    const server = await startSimulatedPiJsonRpcTransportServer();
    const transport = await connectTransport(server);
    const { result } = renderHook(() =>
      usePiSessionState({
        ensureTransportConnected: async () => {
          return {
            sandboxInstanceId: "sbi_123",
            transport,
          };
        },
      }),
    );

    await connectPiSessionForTest({
      providerConversationId: "conversation_test",
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionFile: "/root/.pi/agent/sessions/session.jsonl",
    });

    let acceptedCount = 0;
    let promptPromise: Promise<void> | undefined;
    act(() => {
      promptPromise = result.current.chat.sendPrompt({
        onAccepted: () => {
          acceptedCount += 1;
        },
        submittedPrompt: "Review the diff",
      });
    });

    const promptRequest = await server.nextRequest();
    expectPiRequest(promptRequest, {
      method: "pi/prompt",
      params: {
        sessionFile: "/root/.pi/agent/sessions/session.jsonl",
        message: "Review the diff",
      },
    });
    server.sendJsonError({
      code: -32_000,
      message: "Pi rejected the prompt.",
      request: promptRequest,
    });

    await expect(promptPromise).rejects.toThrow("Pi rejected the prompt.");
    expect(acceptedCount).toBe(0);
  });
});
