// @vitest-environment jsdom

import type { OpenCodeProviderSummary } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
  type StreamDataFrame,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import {
  mapOpenCodeProvidersToComposerModels,
  parseOpenCodePromptModelSelection,
  resolveOriginalOpenCodeSessionId,
  useOpenCodeSessionState,
} from "./use-opencode-session-state.js";

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

async function expectNoOpenCodeRequest(
  server: OpenCodeProxyTransportServer,
  durationMs = 25,
): Promise<void> {
  const noRequest = Symbol("no request");
  const result = await Promise.race([
    server.nextRequest(),
    systemSleeper.sleep(durationMs).then(() => noRequest),
  ]);
  expect(result).toBe(noRequest);
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

function createSessionResponse(
  id: string,
  input?: {
    createdAt?: number;
    directory?: string;
    updatedAt?: number;
  },
) {
  return {
    directory: input?.directory ?? "/workspace",
    id,
    projectID: "project",
    slug: id,
    time: {
      created: input?.createdAt ?? 1,
      updated: input?.updatedAt ?? 2,
    },
    title: "Dashboard session",
    version: "1.14.41",
  };
}

function createOpenCodeProviderCatalogResponse(): {
  providers: readonly OpenCodeProviderSummary[];
  default: Record<string, string>;
} {
  return {
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        source: "api",
        env: [],
        options: {},
        models: {
          "gpt-5": {
            id: "gpt-5",
            providerID: "openai",
            api: {
              id: "gpt-5",
              url: "https://api.openai.com/v1",
              npm: "@ai-sdk/openai",
            },
            name: "GPT-5",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: {
                text: true,
                audio: false,
                image: true,
                video: false,
                pdf: false,
              },
              output: {
                text: true,
                audio: false,
                image: false,
                video: false,
                pdf: false,
              },
              interleaved: false,
            },
            cost: {
              input: 1,
              output: 1,
              cache: {
                read: 0,
                write: 0,
              },
            },
            limit: {
              context: 100_000,
              output: 16_000,
            },
            status: "active",
            options: {},
            headers: {},
            release_date: "2026-01-01",
            variants: {
              high: { reasoningEffort: "high" },
              low: { reasoningEffort: "low" },
            },
          },
        },
      },
    ],
    default: {
      openai: "gpt-5",
    },
  };
}

function expectOpenCodeSandboxSessionsRequest(request: ObservedOpenCodeProxyRequest): void {
  expect(request.request).toMatchObject({
    method: "GET",
    path: "/session?limit=21",
  });
}

function closeTransport(transport: SandboxSessionTransport): void {
  transport.disconnect();
}

async function connectOpenCodeSessionForTest(input: {
  commandsBody?: readonly {
    description?: string;
    hints: readonly string[];
    name: string;
    source?: "command" | "mcp" | "skill";
    template: string;
  }[];
  initialCwd?: string;
  navigatorSessionListBody?: readonly ReturnType<typeof createSessionResponse>[];
  providerSessionId?: string;
  result: { current: ReturnType<typeof useOpenCodeSessionState> };
  sandboxSessionListBody?: readonly ReturnType<typeof createSessionResponse>[];
  sandboxInstanceId: string;
  server: OpenCodeProxyTransportServer;
  sessionId: string;
}): Promise<ObservedOpenCodeProxyRequest> {
  act(() => {
    input.result.current.lifecycle.connectSession({
      ...(input.initialCwd === undefined ? {} : { initialCwd: input.initialCwd }),
      ...(input.providerSessionId === undefined
        ? {}
        : { providerSessionId: input.providerSessionId }),
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

  const providersRequest = await input.server.nextRequest();
  const providersPath =
    input.initialCwd === undefined
      ? "/config/providers"
      : `/config/providers?directory=${encodeURIComponent(input.initialCwd)}`;
  expect(providersRequest.request).toMatchObject({
    method: "GET",
    path: providersPath,
  });
  input.server.sendJsonResponse({
    request: providersRequest,
    body: createOpenCodeProviderCatalogResponse(),
  });

  const commandsRequest = await input.server.nextRequest();
  const commandsPath =
    input.initialCwd === undefined
      ? "/command"
      : `/command?directory=${encodeURIComponent(input.initialCwd)}`;
  expect(commandsRequest.request).toMatchObject({
    method: "GET",
    path: commandsPath,
  });
  input.server.sendJsonResponse({
    request: commandsRequest,
    body: input.commandsBody ?? [],
  });

  const listSessionsRequest = await input.server.nextRequest();
  const listSessionsPath =
    input.initialCwd === undefined
      ? "/session?limit=21"
      : `/session?directory=${encodeURIComponent(input.initialCwd)}&limit=21`;
  expect(listSessionsRequest.request).toMatchObject({
    method: "GET",
    path: listSessionsPath,
  });
  input.server.sendJsonResponse({
    request: listSessionsRequest,
    body: input.navigatorSessionListBody ?? [],
  });

  if (input.initialCwd !== undefined) {
    const sandboxSessionsRequest = await input.server.nextRequest();
    expectOpenCodeSandboxSessionsRequest(sandboxSessionsRequest);
    input.server.sendJsonResponse({
      request: sandboxSessionsRequest,
      body: input.sandboxSessionListBody ?? [],
    });
  }

  const getSessionRequest = await input.server.nextRequest();
  const getSessionPath =
    input.initialCwd === undefined
      ? `/session/${input.sessionId}`
      : `/session/${input.sessionId}?directory=${encodeURIComponent(input.initialCwd)}`;
  expect(getSessionRequest.request).toMatchObject({
    method: "GET",
    path: getSessionPath,
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
  const permissionsPath =
    input.initialCwd === undefined
      ? "/permission"
      : `/permission?directory=${encodeURIComponent(input.initialCwd)}`;
  expect(permissionsRequest.request).toMatchObject({
    method: "GET",
    path: permissionsPath,
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
  it("parses OpenCode provider/model selections", () => {
    expect(parseOpenCodePromptModelSelection("openai/gpt-5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
    expect(parseOpenCodePromptModelSelection("openrouter/openai/gpt-5")).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-5",
    });
    expect(() => parseOpenCodePromptModelSelection("gpt-5")).toThrow(
      "OpenCode model selection must use provider/model format.",
    );
  });

  it("maps OpenCode config providers to composer model options", () => {
    expect(
      mapOpenCodeProvidersToComposerModels({
        providers: createOpenCodeProviderCatalogResponse().providers,
        defaultModelByProvider: {
          openai: "gpt-5",
        },
      }),
    ).toEqual([
      {
        model: "openai/gpt-5",
        displayName: "OpenAI / GPT-5",
        defaultReasoningEffort: "default",
        reasoningEffortOptions: [
          { value: "default", label: "Default" },
          { value: "high", label: "high" },
          { value: "low", label: "low" },
        ],
        inputModalities: ["text", "image"],
        isDefault: true,
      },
    ]);
  });

  it("resolves the original OpenCode session from explicit provider identity before creation order", () => {
    expect(
      resolveOriginalOpenCodeSessionId({
        explicitProviderSessionId: "ses_provider",
        hasMoreSandboxSessions: true,
        sandboxSessions: [
          createSessionResponse("ses_oldest", {
            createdAt: 1,
          }),
        ],
      }),
    ).toBe("ses_provider");
  });

  it("resolves the original OpenCode session from earliest created loaded sandbox session", () => {
    expect(
      resolveOriginalOpenCodeSessionId({
        explicitProviderSessionId: null,
        hasMoreSandboxSessions: false,
        sandboxSessions: [
          createSessionResponse("ses_recent", {
            createdAt: 30,
          }),
          createSessionResponse("ses_old", {
            createdAt: 10,
          }),
          createSessionResponse("ses_same_time_a", {
            createdAt: 10,
          }),
        ],
      }),
    ).toBe("ses_old");
  });

  it("does not infer the original OpenCode session from a capped sandbox page", () => {
    expect(
      resolveOriginalOpenCodeSessionId({
        explicitProviderSessionId: null,
        hasMoreSandboxSessions: true,
        sandboxSessions: [
          createSessionResponse("ses_loaded", {
            createdAt: 1,
          }),
        ],
      }),
    ).toBeNull();
  });

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
    const refreshModelCatalog = result.current.lifecycle.refreshModelCatalog;
    const refreshSessionList = result.current.sessions.refreshSessionList;

    rerender();

    expect(result.current.lifecycle.clearLifecycleErrorMessage).toBe(clearLifecycleErrorMessage);
    expect(result.current.lifecycle.connectSession).toBe(connectSession);
    expect(result.current.lifecycle.disconnectSession).toBe(disconnectSession);
    expect(result.current.lifecycle.recoverSession).toBe(recoverSession);
    expect(result.current.lifecycle.refreshModelCatalog).toBe(refreshModelCatalog);
    expect(result.current.sessions.refreshSessionList).toBe(refreshSessionList);
  });

  it("loads OpenCode prompt commands when connecting a session", async () => {
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
      commandsBody: [
        {
          name: "review",
          description: "review changes",
          source: "command",
          template: "Review $ARGUMENTS",
          hints: ["$ARGUMENTS"],
        },
        {
          name: "customize-opencode",
          description: "customize opencode config",
          source: "skill",
          template: "Customize opencode",
          hints: [],
        },
      ],
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

    expect(result.current.commands.promptCommands.map((command) => command.name)).toEqual([
      "review",
    ]);
    expect(result.current.commandCatalogDirectory).toBeNull();
    expect(result.current.bootstrap.composerCapabilities).toEqual([
      {
        kind: "composerCommand",
        trigger: "/",
        source: "runtimeCommand",
        commands: [
          {
            id: "opencode.prompt.review",
            name: "review",
            description: "review changes",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
        ],
      },
    ]);
  });

  it("ignores stale OpenCode prompt command refreshes after reconnecting to another directory", async () => {
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

    act(() => {
      result.current.lifecycle.connectSession({
        initialCwd: "/workspace/old",
        sandboxInstanceId: "sbi_123",
        targetSessionId: "ses_old",
      });
    });

    const oldHealthRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: oldHealthRequest,
      body: {
        healthy: true,
        version: "1.14.41",
      },
    });
    const oldProvidersRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: oldProvidersRequest,
      body: createOpenCodeProviderCatalogResponse(),
    });
    const staleCommandsRequest = await server.nextRequest();
    expect(staleCommandsRequest.request).toMatchObject({
      method: "GET",
      path: "/command?directory=%2Fworkspace%2Fold",
    });

    act(() => {
      result.current.lifecycle.connectSession({
        initialCwd: "/workspace/new",
        sandboxInstanceId: "sbi_123",
        targetSessionId: "ses_new",
      });
    });

    const newHealthRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newHealthRequest,
      body: {
        healthy: true,
        version: "1.14.41",
      },
    });
    const newProvidersRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newProvidersRequest,
      body: createOpenCodeProviderCatalogResponse(),
    });
    const newCommandsRequest = await server.nextRequest();
    expect(newCommandsRequest.request).toMatchObject({
      method: "GET",
      path: "/command?directory=%2Fworkspace%2Fnew",
    });
    server.sendJsonResponse({
      request: newCommandsRequest,
      body: [
        {
          name: "review",
          description: "review changes",
          source: "command",
          template: "Review $ARGUMENTS",
          hints: ["$ARGUMENTS"],
        },
      ],
    });
    const newSessionsRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newSessionsRequest,
      body: [createSessionResponse("ses_new")],
    });
    const newSandboxSessionsRequest = await server.nextRequest();
    expectOpenCodeSandboxSessionsRequest(newSandboxSessionsRequest);
    server.sendJsonResponse({
      request: newSandboxSessionsRequest,
      body: [createSessionResponse("ses_new")],
    });
    const newSessionRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newSessionRequest,
      body: createSessionResponse("ses_new"),
    });
    const newEventRequest = await server.nextRequest();
    server.sendSseOpenResponse({
      request: newEventRequest,
    });
    const newMessagesRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newMessagesRequest,
      body: [],
    });
    const newPermissionsRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newPermissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionSnapshot?.activeDirectory).toBe("/workspace/new");
    });
    expect(result.current.commandCatalogDirectory).toBe("/workspace/new");
    expect(result.current.commands.promptCommands.map((command) => command.name)).toEqual([
      "review",
    ]);

    server.sendJsonResponse({
      request: staleCommandsRequest,
      body: [
        {
          name: "old-only",
          description: "old directory command",
          source: "command",
          template: "Old $ARGUMENTS",
          hints: ["$ARGUMENTS"],
        },
      ],
    });

    await waitFor(() => {
      expect(result.current.commands.promptCommands.map((command) => command.name)).toEqual([
        "review",
      ]);
    });
  });

  it("does not refresh prompt commands from a superseded connection after model catalog loading completes", async () => {
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

    act(() => {
      result.current.lifecycle.connectSession({
        initialCwd: "/workspace/old",
        sandboxInstanceId: "sbi_123",
        targetSessionId: "ses_old",
      });
    });

    const oldHealthRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: oldHealthRequest,
      body: {
        healthy: true,
        version: "1.14.41",
      },
    });
    const oldProvidersRequest = await server.nextRequest();
    expect(oldProvidersRequest.request).toMatchObject({
      method: "GET",
      path: "/config/providers?directory=%2Fworkspace%2Fold",
    });

    act(() => {
      result.current.lifecycle.connectSession({
        initialCwd: "/workspace/new",
        sandboxInstanceId: "sbi_123",
        targetSessionId: "ses_new",
      });
    });

    const newHealthRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newHealthRequest,
      body: {
        healthy: true,
        version: "1.14.41",
      },
    });
    const newProvidersRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newProvidersRequest,
      body: createOpenCodeProviderCatalogResponse(),
    });
    const newCommandsRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newCommandsRequest,
      body: [
        {
          name: "review",
          description: "review changes",
          source: "command",
          template: "Review $ARGUMENTS",
          hints: ["$ARGUMENTS"],
        },
      ],
    });
    const newSessionsRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newSessionsRequest,
      body: [createSessionResponse("ses_new")],
    });
    const newSandboxSessionsRequest = await server.nextRequest();
    expectOpenCodeSandboxSessionsRequest(newSandboxSessionsRequest);
    server.sendJsonResponse({
      request: newSandboxSessionsRequest,
      body: [createSessionResponse("ses_new")],
    });
    const newSessionRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newSessionRequest,
      body: createSessionResponse("ses_new"),
    });
    const newEventRequest = await server.nextRequest();
    server.sendSseOpenResponse({
      request: newEventRequest,
    });
    const newMessagesRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newMessagesRequest,
      body: [],
    });
    const newPermissionsRequest = await server.nextRequest();
    server.sendJsonResponse({
      request: newPermissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionSnapshot?.activeDirectory).toBe("/workspace/new");
    });

    server.sendJsonResponse({
      request: oldProvidersRequest,
      body: createOpenCodeProviderCatalogResponse(),
    });

    await expectNoOpenCodeRequest(server);
    expect(result.current.commandCatalogDirectory).toBe("/workspace/new");
    expect(result.current.commands.promptCommands.map((command) => command.name)).toEqual([
      "review",
    ]);
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

  it("keeps the original OpenCode session stable after selecting another session", async () => {
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
      navigatorSessionListBody: [
        createSessionResponse("ses_recent", {
          createdAt: 30,
          updatedAt: 50,
        }),
        createSessionResponse("ses_original", {
          createdAt: 10,
          updatedAt: 20,
        }),
      ],
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_recent",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.sessions.originalSessionId).toBe("ses_original");
    });
    await waitFor(() => {
      expect(result.current.lifecycle.sessionConnectionState).toBe("connected");
    });

    let resumePromise: Promise<string> | undefined;
    act(() => {
      resumePromise = result.current.sessions.resumeSession("ses_newer");
    });

    const getSessionRequest = await server.nextRequest();
    expect(getSessionRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_newer",
    });
    server.sendJsonResponse({
      request: getSessionRequest,
      body: createSessionResponse("ses_newer", {
        createdAt: 40,
        updatedAt: 60,
      }),
    });

    const messagesRequest = await server.nextRequest();
    expect(messagesRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_newer/message",
    });
    server.sendJsonResponse({
      request: messagesRequest,
      body: [],
    });

    const permissionsAfterResumeRequest = await server.nextRequest();
    expect(permissionsAfterResumeRequest.request).toMatchObject({
      method: "GET",
      path: "/permission",
    });
    server.sendJsonResponse({
      request: permissionsAfterResumeRequest,
      body: [],
    });

    const commandsAfterResumeRequest = await server.nextRequest();
    expect(commandsAfterResumeRequest.request).toMatchObject({
      method: "GET",
      path: "/command",
    });
    server.sendJsonResponse({
      request: commandsAfterResumeRequest,
      body: [],
    });

    await expect(resumePromise).resolves.toBe("ses_newer");
    expect(result.current.sessions.originalSessionId).toBe("ses_original");
  });

  it("uses the provider OpenCode session as original when the sandbox supplies one", async () => {
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
      navigatorSessionListBody: [
        createSessionResponse("ses_oldest", {
          createdAt: 1,
        }),
      ],
      providerSessionId: "ses_provider",
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_provider",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.sessions.originalSessionId).toBe("ses_provider");
    });
    await waitFor(() => {
      expect(result.current.lifecycle.sessionSnapshot?.providerSessionId).toBe("ses_provider");
    });
  });

  it("clears the original OpenCode session after a failed reconnect", async () => {
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
      navigatorSessionListBody: [
        createSessionResponse("ses_original", {
          createdAt: 1,
        }),
      ],
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_original",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.sessions.originalSessionId).toBe("ses_original");
    });

    act(() => {
      result.current.lifecycle.connectSession({
        sandboxInstanceId: "sbi_123",
        targetSessionId: "ses_original",
      });
    });

    const healthRequest = await server.nextRequest();
    expect(healthRequest.request).toMatchObject({
      method: "GET",
      path: "/global/health",
    });
    server.sendJsonError({
      request: healthRequest,
      status: 500,
      body: {
        message: "health check failed",
      },
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionConnectionState).toBe("detached");
    });
    expect(result.current.sessions.originalSessionId).toBeNull();
  });

  it("does not expose an inferred original OpenCode session when the sandbox session list is capped", async () => {
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

    const cappedSessions = Array.from({ length: 21 }, (_, index) =>
      createSessionResponse(`ses_${String(index).padStart(2, "0")}`, {
        createdAt: index + 1,
        updatedAt: 100 - index,
      }),
    );
    const permissionsRequest = await connectOpenCodeSessionForTest({
      navigatorSessionListBody: cappedSessions,
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_00",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionConnectionState).toBe("connected");
    });
    expect(result.current.sessions.originalSessionId).toBeNull();
    expect(result.current.sessions.availableSessions).toHaveLength(20);
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
        model: {
          modelID: "gpt-5",
          providerID: "openai",
        },
        variant: "high",
        submittedAttachments: [
          {
            type: "file",
            url: "file:///root/.local/attachments/ses_test/screenshot.png",
            filename: "screenshot.png",
            mime: "image/png",
          },
        ],
        submittedPrompt: "Run tests",
      });
    });

    const promptRequest = await server.nextRequest();
    expect(promptRequest.request).toMatchObject({
      method: "POST",
      path: "/session/ses_test/prompt_async?directory=%2Fworkspace%2Fselected-repo",
      body: {
        model: {
          modelID: "gpt-5",
          providerID: "openai",
        },
        variant: "high",
        parts: [
          {
            filename: "screenshot.png",
            mime: "image/png",
            type: "file",
            url: "file:///root/.local/attachments/ses_test/screenshot.png",
          },
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

  it("sends OpenCode prompt commands through the session command endpoint", async () => {
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
      commandsBody: [
        {
          name: "review",
          description: "review changes",
          source: "command",
          template: "Review $ARGUMENTS",
          hints: ["$ARGUMENTS"],
        },
      ],
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

    let commandPromise: Promise<void> | undefined;
    act(() => {
      commandPromise = result.current.commands.sendPromptCommand({
        directory: "/workspace/selected-repo",
        model: {
          modelID: "gpt-5",
          providerID: "openai",
        },
        variant: "high",
        text: "/review check auth",
      });
    });

    const commandRequest = await server.nextRequest();
    expect(commandRequest.request).toMatchObject({
      method: "POST",
      path: "/session/ses_test/command?directory=%2Fworkspace%2Fselected-repo",
      body: {
        command: "review",
        arguments: "check auth",
        model: "openai/gpt-5",
        variant: "high",
      },
    });
    server.sendJsonResponse({
      request: commandRequest,
      body: {
        info: {
          id: "msg_user",
          sessionID: "ses_test",
          role: "user",
          time: {
            created: 1,
          },
          agent: "build",
          model: {
            providerID: "openai",
            modelID: "gpt-5",
          },
        },
        parts: [],
      },
    });
    await expect(commandPromise).resolves.toBeUndefined();
  });

  it("waits for OpenCode to update the session title before returning it", async () => {
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

    let titlePromise: Promise<string> | undefined;
    act(() => {
      titlePromise = result.current.chat.waitForGeneratedSessionTitle();
    });

    const staleTitleRequest = await server.nextRequest();
    expect(staleTitleRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test",
    });
    server.sendJsonResponse({
      request: staleTitleRequest,
      body: createSessionResponse("ses_test"),
    });

    const generatedTitleRequest = await server.nextRequest();
    expect(generatedTitleRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test",
    });
    server.sendJsonResponse({
      request: generatedTitleRequest,
      body: {
        ...createSessionResponse("ses_test"),
        title: " Investigate   flaky tests. ",
      },
    });

    await expect(titlePromise).resolves.toBe("Investigate flaky tests");
  });

  it("rejects strict chat hydration when OpenCode message listing fails", async () => {
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

    let hydrationPromise: Promise<void> | undefined;
    act(() => {
      hydrationPromise = result.current.chat.hydrateChatFromSessionOrThrow();
    });
    if (hydrationPromise === undefined) {
      throw new Error("Hydration promise was not initialized.");
    }

    const messagesRequest = await server.nextRequest();
    expect(messagesRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test/message",
    });
    server.sendJsonError({
      request: messagesRequest,
      status: 500,
      body: {
        message: "message listing failed",
      },
    });

    await expect(hydrationPromise).rejects.toThrow("Could not hydrate OpenCode messages.");
    await waitFor(() => {
      expect(result.current.sessionMessage.sessionErrorMessage).toBe(
        "Could not hydrate OpenCode messages.",
      );
    });
  });

  it("preserves pending permissions during strict chat hydration", async () => {
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
    const pendingPermission = {
      always: [],
      id: "perm_existing",
      metadata: {},
      patterns: ["pnpm test"],
      permission: "bash",
      sessionID: "ses_test",
    };

    const permissionsRequest = await connectOpenCodeSessionForTest({
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_test",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [pendingPermission],
    });

    await waitFor(() => {
      expect(result.current.chat.chatState.pendingPermissions).toEqual([pendingPermission]);
    });

    let hydrationPromise: Promise<void> | undefined;
    act(() => {
      hydrationPromise = result.current.chat.hydrateChatFromSessionOrThrow();
    });
    if (hydrationPromise === undefined) {
      throw new Error("Hydration promise was not initialized.");
    }

    const messagesRequest = await server.nextRequest();
    expect(messagesRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test/message",
    });
    server.sendJsonResponse({
      request: messagesRequest,
      body: [],
    });

    const strictPermissionsRequest = await server.nextRequest();
    expect(strictPermissionsRequest.request).toMatchObject({
      method: "GET",
      path: "/permission",
    });
    server.sendJsonResponse({
      request: strictPermissionsRequest,
      body: [pendingPermission],
    });

    await expect(hydrationPromise).resolves.toBeUndefined();
    await waitFor(() => {
      expect(result.current.chat.chatState.pendingPermissions).toEqual([pendingPermission]);
    });
  });

  it("refreshes the model catalog for a new repository directory", async () => {
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
    expect(result.current.modelCatalogDirectory).toBeNull();
    expect(result.current.bootstrap.establishedSnapshot.availableModels).toHaveLength(1);

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.lifecycle.refreshModelCatalog({
        directory: "/workspace/other-repo",
      });
    });

    await waitFor(() => {
      expect(result.current.bootstrap.phase).toEqual({ status: "bootstrapping" });
    });
    expect(result.current.bootstrap.establishedSnapshot.availableModels).toEqual([]);

    const providersRequest = await server.nextRequest();
    expect(providersRequest.request).toMatchObject({
      method: "GET",
      path: "/config/providers?directory=%2Fworkspace%2Fother-repo",
    });
    server.sendJsonResponse({
      request: providersRequest,
      body: createOpenCodeProviderCatalogResponse(),
    });

    await expect(refreshPromise).resolves.toBeUndefined();
    await waitFor(() => {
      expect(result.current.bootstrap.phase).toEqual({ status: "ready" });
    });
    expect(result.current.modelCatalogDirectory).toBe("/workspace/other-repo");
    expect(result.current.bootstrap.establishedSnapshot.availableModels).toEqual([
      expect.objectContaining({
        model: "openai/gpt-5",
      }),
    ]);
  });

  it("reloads model providers when reconnecting to the same repository directory", async () => {
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

    const firstPermissionsRequest = await connectOpenCodeSessionForTest({
      initialCwd: "/workspace/repo",
      result,
      sandboxInstanceId: "sbi_123",
      server,
      sessionId: "ses_test",
    });
    server.sendJsonResponse({
      request: firstPermissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionConnectionState).toBe("connected");
    });
    expect(result.current.modelCatalogDirectory).toBe("/workspace/repo");
    expect(result.current.bootstrap.establishedSnapshot.availableModels).toHaveLength(1);

    act(() => {
      result.current.lifecycle.connectSession({
        initialCwd: "/workspace/repo",
        sandboxInstanceId: "sbi_123",
        targetSessionId: "ses_test",
      });
    });

    await waitFor(() => {
      expect(result.current.bootstrap.phase).toEqual({ status: "bootstrapping" });
    });
    expect(result.current.bootstrap.establishedSnapshot.availableModels).toEqual([]);

    const healthRequest = await server.nextRequest();
    expect(healthRequest.request).toMatchObject({
      method: "GET",
      path: "/global/health",
    });
    server.sendJsonResponse({
      request: healthRequest,
      body: {
        healthy: true,
        version: "1.14.41",
      },
    });

    const providersRequest = await server.nextRequest();
    expect(providersRequest.request).toMatchObject({
      method: "GET",
      path: "/config/providers?directory=%2Fworkspace%2Frepo",
    });
    server.sendJsonResponse({
      request: providersRequest,
      body: createOpenCodeProviderCatalogResponse(),
    });

    const commandsRequest = await server.nextRequest();
    expect(commandsRequest.request).toMatchObject({
      method: "GET",
      path: "/command?directory=%2Fworkspace%2Frepo",
    });
    server.sendJsonResponse({
      request: commandsRequest,
      body: [],
    });

    const listSessionsRequest = await server.nextRequest();
    expect(listSessionsRequest.request).toMatchObject({
      method: "GET",
      path: "/session?directory=%2Fworkspace%2Frepo&limit=21",
    });
    server.sendJsonResponse({
      request: listSessionsRequest,
      body: [],
    });

    const sandboxSessionsRequest = await server.nextRequest();
    expect(sandboxSessionsRequest.request).toMatchObject({
      method: "GET",
      path: "/session?limit=21",
    });
    server.sendJsonResponse({
      request: sandboxSessionsRequest,
      body: [],
    });

    const getSessionRequest = await server.nextRequest();
    expect(getSessionRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test?directory=%2Fworkspace%2Frepo",
    });
    server.sendJsonResponse({
      request: getSessionRequest,
      body: createSessionResponse("ses_test"),
    });

    const eventRequest = await server.nextRequest();
    server.sendSseOpenResponse({
      request: eventRequest,
    });

    const messagesRequest = await server.nextRequest();
    expect(messagesRequest.request).toMatchObject({
      method: "GET",
      path: "/session/ses_test/message",
    });
    server.sendJsonResponse({
      request: messagesRequest,
      body: [],
    });

    const permissionsRequest = await server.nextRequest();
    expect(permissionsRequest.request).toMatchObject({
      method: "GET",
      path: "/permission?directory=%2Fworkspace%2Frepo",
    });
    server.sendJsonResponse({
      request: permissionsRequest,
      body: [],
    });

    await waitFor(() => {
      expect(result.current.lifecycle.sessionConnectionState).toBe("connected");
    });
  });
});
