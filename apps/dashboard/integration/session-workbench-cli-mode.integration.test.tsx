// @vitest-environment jsdom

import { type IncomingMessage, type ServerResponse } from "node:http";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { OpenAiCodexAppServerListenUrl } from "../../../packages/integrations-definitions/src/openai/index.ts";
import {
  decodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
  type PTYStreamChannel,
} from "../../../packages/sandbox-session-protocol/src/index.ts";
import { SessionWorkbenchPage } from "../src/features/pages/session-workbench-page.js";
import { AppShellHeaderActionsContext } from "../src/features/shell/app-shell-header-actions.js";
import { renderDashboardPageIntegration } from "./helpers/dashboard-page.js";

type JsonRpcRequest = {
  id?: string | number;
  method: string;
  params?: unknown;
};

type PtyOpenRecord = {
  streamId: number;
  channel: PTYStreamChannel;
};

type PtyOpenWaiter = {
  predicate: (record: PtyOpenRecord) => boolean;
  reject: (reason?: unknown) => void;
  resolve: (value: PtyOpenRecord) => void;
};

type SessionWorkbenchTunnelServer = {
  close: () => Promise<void>;
  deferNextCliCloseExit: () => { release: () => void };
  deferNextCliOpen: () => { release: () => void };
  emitPtyExit: (streamId: number, exitCode?: number) => void;
  failNextCliOpen: (message: string) => void;
  hangNextThreadList: () => void;
  hangResumeForThread: (threadId: string) => void;
  hangNextAgentThreadListWhileCliSocketOpen: () => void;
  omitLoadedThreadForNextCliOpen: () => void;
  url: string;
  waitForThreadResume: (threadId: string) => Promise<string>;
  waitForPtyClose: (streamId: number) => Promise<number>;
  waitForPtyOpen: (predicate: (record: PtyOpenRecord) => boolean) => Promise<PtyOpenRecord>;
};

type DashboardPageHandle = Awaited<ReturnType<typeof renderDashboardPageIntegration>>;

type SessionWorkbenchCliHarness = {
  controls: {
    failNextCliOpen: (message: string) => void;
    setConnectionTokenFailure: (value: boolean) => void;
    waitForConnectionTokenRequestCount: (count: number) => Promise<void>;
  };
  renderedPage: DashboardPageHandle;
  tunnelServer: SessionWorkbenchTunnelServer;
};

type ThreadResumeWaiter = {
  reject: (reason?: unknown) => void;
  resolve: (value: string) => void;
  threadId: string;
};

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
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

function decodeAgentTextPayload(data: RawData): string {
  const frame = decodeDataFrame(toUint8Array(data));
  if (frame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(frame.payloadKind)}.`,
    );
  }

  return new TextDecoder().decode(frame.payload);
}

function parseJsonRpcRequest(data: RawData): JsonRpcRequest {
  const payload = JSON.parse(decodeAgentTextPayload(data));
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("method" in payload) ||
    typeof payload.method !== "string"
  ) {
    throw new Error("Expected a JSON-RPC request payload.");
  }

  return payload as JsonRpcRequest;
}

function createThreadStartResult(threadId: string) {
  return {
    thread: {
      id: threadId,
    },
  };
}

function installNodeWebSocket(): () => void {
  const originalWebSocket = globalThis.WebSocket;

  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: NodeWebSocket,
    writable: true,
  });

  return () => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
      writable: true,
    });
  };
}

function createDeferredSignal(): {
  promise: Promise<void>;
  release: () => void;
} {
  let isReleased = false;
  let resolvePromise: (() => void) | null = null;

  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    release: () => {
      if (isReleased) {
        return;
      }

      isReleased = true;
      resolvePromise?.();
    },
  };
}

async function startSessionWorkbenchTunnelServer(): Promise<SessionWorkbenchTunnelServer> {
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error: Error) => reject(error));
  });

  const ptyOpenRecords: PtyOpenRecord[] = [];
  const ptyOpenWaiters: PtyOpenWaiter[] = [];
  const ptyCloseStreamIds = new Set<number>();
  const ptyCloseWaiters = new Map<number, Array<(streamId: number) => void>>();
  const ptyChannels = new Map<number, PTYStreamChannel>();
  const ptySockets = new Map<number, WebSocket>();
  const threadResumeRequests: string[] = [];
  const threadResumeWaiters: ThreadResumeWaiter[] = [];
  const threadsById = new Map<
    string,
    {
      summary: {
        createdAt: number;
        id: string;
        name: string;
        updatedAt: number;
      };
      turnCount: number;
    }
  >();
  const loadedThreadIds = new Set<string>();
  const sockets = new Set<WebSocket>();
  let knownThreadId: string | null = null;
  let nextCreatedThreadNumber = 0;
  let nextCliOpenFailureMessage: string | null = null;
  let nextCliOpenGate: ReturnType<typeof createDeferredSignal> | null = null;
  let nextCliCloseExitGate: ReturnType<typeof createDeferredSignal> | null = null;
  let shouldHangNextThreadList = false;
  let shouldHangNextAgentThreadListWhileCliSocketOpen = false;
  let shouldOmitLoadedThreadForNextCliOpen = false;
  const hangingResumeThreadIds = new Set<string>();
  const deferredCliCloseStreamIds = new Set<number>();

  function dispatchPtyOpen(record: PtyOpenRecord): void {
    ptyOpenRecords.push(record);
    const waiterIndex = ptyOpenWaiters.findIndex((waiter) => waiter.predicate(record));
    if (waiterIndex === -1) {
      return;
    }

    const waiter = ptyOpenWaiters.splice(waiterIndex, 1)[0];
    if (waiter === undefined) {
      throw new Error("Expected PTY waiter to be present.");
    }
    waiter.resolve(record);
  }

  function dispatchPtyClose(streamId: number): void {
    ptyCloseStreamIds.add(streamId);
    const waiters = ptyCloseWaiters.get(streamId);
    if (waiters === undefined) {
      return;
    }

    ptyCloseWaiters.delete(streamId);
    for (const resolve of waiters) {
      resolve(streamId);
    }
  }

  function dispatchThreadResume(threadId: string): void {
    threadResumeRequests.push(threadId);
    const waiterIndex = threadResumeWaiters.findIndex((waiter) => waiter.threadId === threadId);
    if (waiterIndex === -1) {
      return;
    }

    const waiter = threadResumeWaiters.splice(waiterIndex, 1)[0];
    if (waiter === undefined) {
      throw new Error("Expected thread resume waiter to be present.");
    }
    waiter.resolve(threadId);
  }

  function ensureThreadRecord(input: { createdAt?: number; id: string; turnCount?: number }): void {
    const existingThread = threadsById.get(input.id);
    if (existingThread !== undefined) {
      threadsById.set(input.id, {
        summary: {
          ...existingThread.summary,
          updatedAt: input.createdAt ?? existingThread.summary.updatedAt,
        },
        turnCount: input.turnCount ?? existingThread.turnCount,
      });
      return;
    }

    const createdAt = input.createdAt ?? nextCreatedThreadNumber + 1;
    nextCreatedThreadNumber = Math.max(nextCreatedThreadNumber, createdAt);
    threadsById.set(input.id, {
      summary: {
        createdAt,
        id: input.id,
        name: "CLI Test Thread",
        updatedAt: createdAt,
      },
      turnCount: input.turnCount ?? 0,
    });
  }

  function emitPtyExit(streamId: number, exitCode = 0): void {
    const socket = ptySockets.get(streamId);
    if (socket === undefined) {
      throw new Error(`Expected PTY socket for stream ${String(streamId)}.`);
    }

    socket.send(
      JSON.stringify({
        type: "stream.event",
        streamId,
        event: {
          type: "pty.exit",
          exitCode,
        },
      }),
    );
  }

  wsServer.on("connection", (socket) => {
    sockets.add(socket);
    let streamKind: "agent" | "pty" | null = null;

    socket.on("message", async (data, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(data));
        if (controlMessage?.type === "stream.open") {
          if (controlMessage.channel.kind === "agent") {
            streamKind = "agent";
          }

          if (controlMessage.channel.kind === "pty") {
            if (
              controlMessage.channel.ptySessionId === "cli" &&
              nextCliOpenFailureMessage !== null
            ) {
              const failureMessage = nextCliOpenFailureMessage;
              nextCliOpenFailureMessage = null;
              socket.send(
                JSON.stringify({
                  type: "stream.open.error",
                  streamId: controlMessage.streamId,
                  code: "pty_open_failed",
                  message: failureMessage,
                }),
              );
              return;
            }

            streamKind = "pty";
            ptySockets.set(controlMessage.streamId, socket);
            ptyChannels.set(controlMessage.streamId, controlMessage.channel);
            dispatchPtyOpen({
              streamId: controlMessage.streamId,
              channel: controlMessage.channel,
            });

            if (
              controlMessage.channel.ptySessionId === "cli" &&
              controlMessage.channel.args?.includes("resume") !== true
            ) {
              knownThreadId = "thread_cli_from_cli";
              ensureThreadRecord({
                id: knownThreadId,
                turnCount: 1,
              });
              if (!shouldOmitLoadedThreadForNextCliOpen) {
                loadedThreadIds.add(knownThreadId);
              }
              shouldOmitLoadedThreadForNextCliOpen = false;
            }

            if (controlMessage.channel.ptySessionId === "cli" && nextCliOpenGate !== null) {
              const openGate = nextCliOpenGate;
              nextCliOpenGate = null;
              await openGate.promise;
            }
          }

          socket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId: controlMessage.streamId,
            }),
          );
          return;
        }

        if (controlMessage?.type === "stream.close") {
          dispatchPtyClose(controlMessage.streamId);
          const channel = ptyChannels.get(controlMessage.streamId);
          if (channel?.ptySessionId === "cli" && nextCliCloseExitGate !== null) {
            deferredCliCloseStreamIds.add(controlMessage.streamId);
            return;
          }

          emitPtyExit(controlMessage.streamId);
          return;
        }

        return;
      }

      if (streamKind !== "agent") {
        return;
      }

      const request = parseJsonRpcRequest(data);
      const requestId = request.id ?? 0;

      switch (request.method) {
        case "initialize": {
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                protocolVersion: "2026-03-14",
              },
            }),
          );
          return;
        }

        case "initialized": {
          return;
        }

        case "thread/list": {
          const hasOpenCliSocket = [...ptyChannels.entries()].some(
            ([streamId, channel]) =>
              channel.ptySessionId === "cli" && ptySockets.get(streamId) !== undefined,
          );
          if (shouldHangNextAgentThreadListWhileCliSocketOpen && hasOpenCliSocket) {
            shouldHangNextAgentThreadListWhileCliSocketOpen = false;
            return;
          }

          if (shouldHangNextThreadList) {
            shouldHangNextThreadList = false;
            return;
          }

          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                data: [...threadsById.values()].map((thread) => thread.summary),
                nextCursor: null,
              },
            }),
          );
          return;
        }

        case "thread/loaded/list": {
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                data: [...loadedThreadIds],
              },
            }),
          );
          return;
        }

        case "thread/start": {
          knownThreadId ??= "thread_cli_test";
          ensureThreadRecord({
            id: knownThreadId,
            turnCount: 0,
          });
          socket.send(
            JSON.stringify({
              id: requestId,
              result: createThreadStartResult(knownThreadId),
            }),
          );
          return;
        }

        case "thread/resume": {
          const params =
            typeof request.params === "object" &&
            request.params !== null &&
            !Array.isArray(request.params)
              ? request.params
              : null;
          const requestedThreadId =
            params !== null &&
            "threadId" in params &&
            typeof params.threadId === "string" &&
            params.threadId.length > 0
              ? params.threadId
              : null;

          if (requestedThreadId === null) {
            throw new Error("Expected thread/resume to provide a thread id.");
          }

          if (hangingResumeThreadIds.has(requestedThreadId)) {
            hangingResumeThreadIds.delete(requestedThreadId);
            return;
          }

          knownThreadId = requestedThreadId;
          ensureThreadRecord({
            id: requestedThreadId,
          });
          loadedThreadIds.add(requestedThreadId);
          dispatchThreadResume(requestedThreadId);
          socket.send(
            JSON.stringify({
              id: requestId,
              result: createThreadStartResult(requestedThreadId),
            }),
          );
          return;
        }

        case "thread/read": {
          const params =
            typeof request.params === "object" &&
            request.params !== null &&
            !Array.isArray(request.params)
              ? request.params
              : null;
          const requestedThreadId =
            params !== null &&
            "threadId" in params &&
            typeof params.threadId === "string" &&
            params.threadId.length > 0
              ? params.threadId
              : (knownThreadId ?? "thread_cli_test");
          const threadRecord = threadsById.get(requestedThreadId);
          if (threadRecord === undefined || threadRecord.turnCount === 0) {
            socket.send(
              JSON.stringify({
                id: requestId,
                error: {
                  code: -32600,
                  message: `thread ${requestedThreadId} is not materialized yet; includeTurns is unavailable before first user message`,
                },
              }),
            );
            return;
          }

          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                thread: {
                  id: requestedThreadId,
                  turns: [
                    {
                      id: `${requestedThreadId}_turn_1`,
                      items: [],
                      status: "completed",
                    },
                  ],
                },
              },
            }),
          );
          return;
        }

        case "model/list": {
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                data: [
                  {
                    id: "mdl_gpt53",
                    model: "gpt-5.3-codex",
                    displayName: "GPT-5.3 Codex",
                    hidden: false,
                    isDefault: true,
                    inputModalities: ["text", "image"],
                    supportsPersonality: false,
                  },
                ],
                nextCursor: null,
              },
            }),
          );
          return;
        }

        case "config/read": {
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                config: {},
              },
            }),
          );
          return;
        }

        default: {
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {},
            }),
          );
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
      for (const [streamId, candidateSocket] of ptySockets.entries()) {
        if (candidateSocket === socket) {
          ptySockets.delete(streamId);
          ptyChannels.delete(streamId);
        }
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a socket address.");
  }

  return {
    deferNextCliCloseExit: () => {
      const gate = createDeferredSignal();
      nextCliCloseExitGate = gate;

      return {
        release: () => {
          gate.release();
          nextCliCloseExitGate = null;
          for (const streamId of deferredCliCloseStreamIds) {
            emitPtyExit(streamId);
            deferredCliCloseStreamIds.delete(streamId);
          }
        },
      };
    },
    deferNextCliOpen: () => {
      const gate = createDeferredSignal();
      nextCliOpenGate = gate;

      return {
        release: gate.release,
      };
    },
    emitPtyExit,
    failNextCliOpen: (message) => {
      nextCliOpenFailureMessage = message;
    },
    hangNextThreadList: () => {
      shouldHangNextThreadList = true;
    },
    hangResumeForThread: (threadId) => {
      hangingResumeThreadIds.add(threadId);
    },
    hangNextAgentThreadListWhileCliSocketOpen: () => {
      shouldHangNextAgentThreadListWhileCliSocketOpen = true;
    },
    omitLoadedThreadForNextCliOpen: () => {
      shouldOmitLoadedThreadForNextCliOpen = true;
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
    waitForThreadResume: async (threadId) => {
      if (threadResumeRequests.includes(threadId)) {
        return threadId;
      }

      return await new Promise<string>((resolve, reject) => {
        threadResumeWaiters.push({
          threadId,
          resolve,
          reject,
        });
      });
    },
    waitForPtyClose: async (streamId) => {
      if (ptyCloseStreamIds.has(streamId)) {
        return streamId;
      }

      return await new Promise<number>((resolve) => {
        const currentWaiters = ptyCloseWaiters.get(streamId) ?? [];
        currentWaiters.push(resolve);
        ptyCloseWaiters.set(streamId, currentWaiters);
      });
    },
    waitForPtyOpen: async (predicate) => {
      const existingRecord = ptyOpenRecords.find(predicate);
      if (existingRecord !== undefined) {
        return existingRecord;
      }

      return await new Promise<PtyOpenRecord>((resolve, reject) => {
        ptyOpenWaiters.push({
          predicate,
          resolve,
          reject,
        });
      });
    },
    close: async () => {
      for (const waiter of ptyOpenWaiters.splice(0, ptyOpenWaiters.length)) {
        waiter.reject(new Error("PTY open waiter was canceled while closing the test server."));
      }
      for (const waiter of threadResumeWaiters.splice(0, threadResumeWaiters.length)) {
        waiter.reject(
          new Error("Thread resume waiter was canceled while closing the test server."),
        );
      }

      for (const socket of sockets) {
        socket.close();
      }

      await new Promise<void>((resolve, reject) => {
        wsServer.close((error?: Error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

function extractSandboxInstanceId(pathname: string): string | null {
  const match = pathname.match(/^\/v1\/sandbox\/instances\/([^/]+)$/);
  return match?.[1] ?? null;
}

function extractConnectionTokenSandboxInstanceId(pathname: string): string | null {
  const match = pathname.match(/^\/v1\/sandbox\/instances\/([^/]+)\/connection-tokens$/);
  return match?.[1] ?? null;
}

function createWorkbenchRequestHandler(
  tunnelServer: SessionWorkbenchTunnelServer,
  controls: {
    getConnectionTokenFailure: () => boolean;
    onConnectionTokenMinted: () => void;
  },
): (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void {
  return (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const statusSandboxInstanceId = extractSandboxInstanceId(requestUrl.pathname);
    const connectionTokenSandboxInstanceId = extractConnectionTokenSandboxInstanceId(
      requestUrl.pathname,
    );

    if (
      request.method === "GET" &&
      statusSandboxInstanceId !== null &&
      requestUrl.pathname === `/v1/sandbox/instances/${statusSandboxInstanceId}`
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: statusSandboxInstanceId,
          status: "running",
          failureCode: null,
          failureMessage: null,
          automationConversation: null,
        }),
      );
      return;
    }

    if (
      request.method === "POST" &&
      connectionTokenSandboxInstanceId !== null &&
      requestUrl.pathname ===
        `/v1/sandbox/instances/${connectionTokenSandboxInstanceId}/connection-tokens`
    ) {
      controls.onConnectionTokenMinted();

      if (controls.getConnectionTokenFailure()) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Could not mint connection token." }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          instanceId: connectionTokenSandboxInstanceId,
          url: tunnelServer.url,
          token: "tok_cli_test",
          expiresAt: "2026-03-31T00:00:00.000Z",
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  };
}

function HeaderActionsHost(input: { children: React.ReactNode }): React.JSX.Element {
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);

  return (
    <AppShellHeaderActionsContext.Provider value={setHeaderActions}>
      <div>
        <div data-testid="header-actions">{headerActions}</div>
        {input.children}
      </div>
    </AppShellHeaderActionsContext.Provider>
  );
}

async function renderSessionWorkbenchCliHarness(): Promise<SessionWorkbenchCliHarness> {
  const tunnelServer = await startSessionWorkbenchTunnelServer();
  let shouldFailConnectionTokens = false;
  let connectionTokenRequestCount = 0;
  const connectionTokenCountWaiters = new Map<number, Array<() => void>>();
  const renderedPage = await renderDashboardPageIntegration({
    handler: createWorkbenchRequestHandler(tunnelServer, {
      getConnectionTokenFailure: () => shouldFailConnectionTokens,
      onConnectionTokenMinted: () => {
        connectionTokenRequestCount += 1;
        for (const [count, waiters] of connectionTokenCountWaiters.entries()) {
          if (connectionTokenRequestCount >= count) {
            connectionTokenCountWaiters.delete(count);
            for (const resolve of waiters) {
              resolve();
            }
          }
        }
      },
    }),
    ui: (
      <HeaderActionsHost>
        <MemoryRouter initialEntries={["/sessions/sbi_cli_test"]}>
          <Routes>
            <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
          </Routes>
        </MemoryRouter>
      </HeaderActionsHost>
    ),
  });

  return {
    controls: {
      failNextCliOpen: (message) => {
        tunnelServer.failNextCliOpen(message);
      },
      setConnectionTokenFailure: (value) => {
        shouldFailConnectionTokens = value;
      },
      waitForConnectionTokenRequestCount: async (count) => {
        if (connectionTokenRequestCount >= count) {
          return;
        }

        await new Promise<void>((resolve) => {
          const currentWaiters = connectionTokenCountWaiters.get(count) ?? [];
          currentWaiters.push(resolve);
          connectionTokenCountWaiters.set(count, currentWaiters);
        });
      },
    },
    renderedPage,
    tunnelServer,
  };
}

async function withSessionWorkbenchCliHarness(
  run: (harness: SessionWorkbenchCliHarness) => Promise<void>,
): Promise<void> {
  const restoreWebSocket = installNodeWebSocket();
  const harness = await renderSessionWorkbenchCliHarness();

  try {
    await run(harness);
  } finally {
    await harness.renderedPage.close();
    await harness.tunnelServer.close();
    restoreWebSocket();
  }
}

async function waitForEnabledButton(name: string): Promise<HTMLButtonElement> {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => {
    expect(button).toHaveProperty("disabled", false);
  });

  return button as HTMLButtonElement;
}

async function waitForPtySession(
  tunnelServer: SessionWorkbenchTunnelServer,
  ptySessionId: string,
): Promise<PtyOpenRecord> {
  return await tunnelServer.waitForPtyOpen(
    (record) => record.channel.ptySessionId === ptySessionId,
  );
}

function expectCliPty(record: PtyOpenRecord): void {
  expect(record.channel.session).toBe("create");
  expect(record.channel.ptySessionId).toBe("cli");
  expect(record.channel.command).toBe("codex");
  expect(record.channel.args).toEqual(["--remote", OpenAiCodexAppServerListenUrl]);
}

function expectTerminalPty(record: PtyOpenRecord): void {
  expect(record.channel.session).toBe("create");
  expect(record.channel.ptySessionId).toBe("terminal");
  expect(record.channel.command).toBeUndefined();
  expect(record.channel.args).toBeUndefined();
}

describe("SessionWorkbenchPage CLI mode integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("runs Codex CLI in the primary panel while keeping the side terminal available", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");
      expectCliPty(cliPty);

      expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();

      fireEvent.click(await waitForEnabledButton("Open terminal"));
      expectTerminalPty(await waitForPtySession(tunnelServer, "terminal"));

      fireEvent.click(screen.getByRole("button", { name: "CLI" }));
      await tunnelServer.waitForPtyClose(cliPty.streamId);
      await tunnelServer.waitForThreadResume("thread_cli_from_cli");

      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
      expect(screen.queryByTitle("Codex CLI")).toBeNull();
    });
  });

  it("starts a new CLI session when the connected chat thread is not materialized yet", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");

      expectCliPty(cliPty);
      expect(screen.queryByText("Could not start Codex CLI")).toBeNull();
    });
  });

  it("opens the CLI after the side terminal without PTY session collisions", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("Open terminal"));
      expectTerminalPty(await waitForPtySession(tunnelServer, "terminal"));

      fireEvent.click(await waitForEnabledButton("CLI"));
      expectCliPty(await waitForPtySession(tunnelServer, "cli"));

      expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.queryByText("pty session already exists")).toBeNull();
    });
  });

  it("returns to chat even after the CLI PTY has already exited", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");
      expectCliPty(cliPty);
      tunnelServer.emitPtyExit(cliPty.streamId);
      await tunnelServer.waitForThreadResume("thread_cli_from_cli");

      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
      expect(screen.queryByPlaceholderText("Ask anything")).toBeDefined();
    });
  }, 15_000);

  it("shows a dedicated CLI entry failure surface and lets the user return to chat", async () => {
    await withSessionWorkbenchCliHarness(async ({ controls }) => {
      controls.failNextCliOpen("codex executable missing");

      fireEvent.click(await waitForEnabledButton("CLI"));

      expect(await screen.findByText("Could not start Codex CLI")).toBeDefined();
      expect(screen.getByText("codex executable missing")).toBeDefined();
      expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Return to chat" }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
      });
    });
  });

  it("shows a restore failure surface and retries chat restoration explicitly", async () => {
    await withSessionWorkbenchCliHarness(async ({ controls, tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");
      expectCliPty(cliPty);
      controls.setConnectionTokenFailure(true);
      tunnelServer.emitPtyExit(cliPty.streamId);

      expect(await screen.findByText("Could not restore chat")).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry restoring chat" })).toBeDefined();

      controls.setConnectionTokenFailure(false);
      fireEvent.click(screen.getByRole("button", { name: "Retry restoring chat" }));

      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
    });
  }, 15_000);

  it("restores non-provider sessions from the newest available CLI-created thread even when it is not loaded yet", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      tunnelServer.omitLoadedThreadForNextCliOpen();

      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");
      expectCliPty(cliPty);
      fireEvent.click(screen.getByRole("button", { name: "CLI" }));

      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
    });
  }, 15_000);

  it("does not try to reconnect chat through the provisional empty thread after leaving CLI", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");
      expectCliPty(cliPty);
      tunnelServer.hangResumeForThread("thread_cli_test");
      fireEvent.click(screen.getByRole("button", { name: "CLI" }));

      await tunnelServer.waitForThreadResume("thread_cli_from_cli");
      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
    });
  }, 15_000);

  it("fails restore explicitly instead of hanging forever when reconnect never establishes an active thread", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("CLI"));
      const cliPty = await waitForPtySession(tunnelServer, "cli");
      expectCliPty(cliPty);
      tunnelServer.hangNextThreadList();
      fireEvent.click(screen.getByRole("button", { name: "CLI" }));

      await waitFor(
        () => {
          expect(screen.getByText("Could not restore chat")).toBeDefined();
          expect(screen.getByText("Timed out while restoring chat.")).toBeDefined();
        },
        { timeout: 35_000 },
      );
    });
  }, 45_000);
});
