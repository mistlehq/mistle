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
  emitPtyExit: (streamId: number, exitCode?: number) => void;
  url: string;
  waitForPtyClose: (streamId: number) => Promise<number>;
  waitForPtyOpen: (predicate: (record: PtyOpenRecord) => boolean) => Promise<PtyOpenRecord>;
};

type DashboardPageHandle = Awaited<ReturnType<typeof renderDashboardPageIntegration>>;

type SessionWorkbenchCliHarness = {
  renderedPage: DashboardPageHandle;
  tunnelServer: SessionWorkbenchTunnelServer;
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
  const ptySockets = new Map<number, WebSocket>();
  const sockets = new Set<WebSocket>();
  let knownThreadId: string | null = null;

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

    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(data));
        if (controlMessage?.type === "stream.open") {
          if (controlMessage.channel.kind === "agent") {
            streamKind = "agent";
          }

          if (controlMessage.channel.kind === "pty") {
            streamKind = "pty";
            ptySockets.set(controlMessage.streamId, socket);
            dispatchPtyOpen({
              streamId: controlMessage.streamId,
              channel: controlMessage.channel,
            });
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
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                data:
                  knownThreadId === null
                    ? []
                    : [
                        {
                          id: knownThreadId,
                          name: "CLI Test Thread",
                          preview: null,
                          createdAt: 1,
                          updatedAt: 1,
                        },
                      ],
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
                data: [],
              },
            }),
          );
          return;
        }

        case "thread/start": {
          knownThreadId ??= "thread_cli_test";
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

          knownThreadId = requestedThreadId;
          socket.send(
            JSON.stringify({
              id: requestId,
              result: createThreadStartResult(requestedThreadId),
            }),
          );
          return;
        }

        case "thread/read": {
          socket.send(
            JSON.stringify({
              id: requestId,
              result: {
                thread: {
                  id: knownThreadId ?? "thread_cli_test",
                  turns: [],
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
        }
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a socket address.");
  }

  return {
    emitPtyExit,
    url: `ws://127.0.0.1:${String(address.port)}`,
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
  const renderedPage = await renderDashboardPageIntegration({
    handler: createWorkbenchRequestHandler(tunnelServer),
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
  expect(record.channel.args).toEqual([
    "resume",
    "--remote",
    OpenAiCodexAppServerListenUrl,
    "thread_cli_test",
  ]);
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

      expect(await screen.findByText("Codex CLI connected")).toBeDefined();
      expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();

      fireEvent.click(await waitForEnabledButton("Open terminal"));
      expectTerminalPty(await waitForPtySession(tunnelServer, "terminal"));

      fireEvent.click(screen.getByRole("button", { name: "CLI" }));
      await tunnelServer.waitForPtyClose(cliPty.streamId);

      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
      expect(screen.queryByText("Codex CLI connected")).toBeNull();
    });
  });

  it("opens the CLI after the side terminal without PTY session collisions", async () => {
    await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
      fireEvent.click(await waitForEnabledButton("Open terminal"));
      expectTerminalPty(await waitForPtySession(tunnelServer, "terminal"));

      fireEvent.click(await waitForEnabledButton("CLI"));
      expectCliPty(await waitForPtySession(tunnelServer, "cli"));

      expect(await screen.findByText("Codex CLI connected")).toBeDefined();
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
      expect(await screen.findByText("Codex CLI connected")).toBeDefined();

      tunnelServer.emitPtyExit(cliPty.streamId);

      await waitFor(
        () => {
          expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        },
        { timeout: 5_000 },
      );
      expect(screen.queryByText("Codex CLI connected")).toBeNull();
    });
  }, 15_000);
});
