// @vitest-environment jsdom

import { type IncomingMessage, type ServerResponse } from "node:http";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  type RawData,
  type WebSocket,
  WebSocket as NodeWebSocket,
  WebSocketServer,
} from "../../../node_modules/.pnpm/node_modules/ws/index.js";
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
  url: string;
  waitForPtyOpen: (predicate: (record: PtyOpenRecord) => boolean) => Promise<PtyOpenRecord>;
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
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a socket address.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
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

describe("SessionWorkbenchPage CLI mode integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("runs Codex CLI in the primary panel while keeping the side terminal available", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const originalMatchMedia = window.matchMedia;
    const originalGetContextDescriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    const originalGetContext = originalGetContextDescriptor?.value;
    const originalResizeObserver = globalThis.ResizeObserver;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: NodeWebSocket,
      writable: true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => {
        return {
          addEventListener() {},
          addListener() {},
          dispatchEvent() {
            return false;
          },
          matches: false,
          media: query,
          onchange: null,
          removeEventListener() {},
          removeListener() {},
        };
      },
      writable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => {
        return {
          canvas: document.createElement("canvas"),
          beginPath() {},
          clearRect() {},
          clip() {},
          closePath() {},
          createImageData() {
            return {
              colorSpace: "srgb",
              data: new Uint8ClampedArray(4),
              height: 1,
              width: 1,
            };
          },
          createLinearGradient() {
            return {
              addColorStop() {},
            };
          },
          drawImage() {},
          fill() {},
          fillRect() {},
          fillText() {},
          getImageData() {
            return {
              colorSpace: "srgb",
              data: new Uint8ClampedArray(4),
              height: 1,
              width: 1,
            };
          },
          lineTo() {},
          measureText() {
            return {
              actualBoundingBoxAscent: 0,
              actualBoundingBoxDescent: 0,
              actualBoundingBoxLeft: 0,
              actualBoundingBoxRight: 0,
              fontBoundingBoxAscent: 0,
              fontBoundingBoxDescent: 0,
              width: 0,
            };
          },
          moveTo() {},
          putImageData() {},
          rect() {},
          restore() {},
          save() {},
          scale() {},
          setLineDash() {},
          setTransform() {},
          stroke() {},
          strokeRect() {},
          translate() {},
        };
      },
      writable: true,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
    const tunnelServer = await startSessionWorkbenchTunnelServer();
    const renderedPage = await renderDashboardPageIntegration({
      handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
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
      },
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

    try {
      const cliButton = await screen.findByRole("button", { name: "CLI" });
      await waitFor(() => {
        expect(cliButton).toHaveProperty("disabled", false);
      });

      fireEvent.click(cliButton);

      const cliPtyOpen = await tunnelServer.waitForPtyOpen((record) => {
        return record.channel.command === "codex";
      });
      expect(cliPtyOpen.channel.session).toBe("create");
      expect(cliPtyOpen.channel.ptySessionId).toBe("cli");
      expect(cliPtyOpen.channel.command).toBe("codex");
      expect(cliPtyOpen.channel.args).toEqual([
        "resume",
        "--remote",
        OpenAiCodexAppServerListenUrl,
        "thread_cli_test",
      ]);

      expect(await screen.findByText("Codex CLI connected")).toBeDefined();
      expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();

      const openTerminalButton = screen.getByRole("button", { name: "Open terminal" });
      await waitFor(() => {
        expect(openTerminalButton).toHaveProperty("disabled", false);
      });
      fireEvent.click(openTerminalButton);

      const sideTerminalPtyOpen = await tunnelServer.waitForPtyOpen((record) => {
        return record.channel.command === undefined;
      });
      expect(sideTerminalPtyOpen.channel.session).toBe("create");
      expect(sideTerminalPtyOpen.channel.ptySessionId).toBe("terminal");
      expect(sideTerminalPtyOpen.channel.command).toBeUndefined();
      expect(sideTerminalPtyOpen.channel.args).toBeUndefined();

      fireEvent.click(screen.getByRole("button", { name: "CLI" }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
      });
      expect(screen.queryByText("Codex CLI connected")).toBeNull();
      expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    } finally {
      await renderedPage.close();
      await tunnelServer.close();
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: originalWebSocket,
        writable: true,
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
        writable: true,
      });
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value:
          originalGetContext === undefined
            ? undefined
            : function getContext(
                this: HTMLCanvasElement,
                ...args: Parameters<NonNullable<HTMLCanvasElement["getContext"]>>
              ) {
                return originalGetContext.call(this, ...args);
              },
        writable: true,
      });
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
        writable: true,
      });
    }
  });

  it("opens the CLI after the side terminal without PTY session collisions", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const originalMatchMedia = window.matchMedia;
    const originalGetContextDescriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    const originalGetContext = originalGetContextDescriptor?.value;
    const originalResizeObserver = globalThis.ResizeObserver;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: NodeWebSocket,
      writable: true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => {
        return {
          addEventListener() {},
          addListener() {},
          dispatchEvent() {
            return false;
          },
          matches: false,
          media: query,
          onchange: null,
          removeEventListener() {},
          removeListener() {},
        };
      },
      writable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => {
        return {
          canvas: document.createElement("canvas"),
          beginPath() {},
          clearRect() {},
          clip() {},
          closePath() {},
          createImageData() {
            return {
              colorSpace: "srgb",
              data: new Uint8ClampedArray(4),
              height: 1,
              width: 1,
            };
          },
          createLinearGradient() {
            return {
              addColorStop() {},
            };
          },
          drawImage() {},
          fill() {},
          fillRect() {},
          fillText() {},
          getImageData() {
            return {
              colorSpace: "srgb",
              data: new Uint8ClampedArray(4),
              height: 1,
              width: 1,
            };
          },
          lineTo() {},
          measureText() {
            return {
              actualBoundingBoxAscent: 0,
              actualBoundingBoxDescent: 0,
              actualBoundingBoxLeft: 0,
              actualBoundingBoxRight: 0,
              fontBoundingBoxAscent: 0,
              fontBoundingBoxDescent: 0,
              width: 0,
            };
          },
          moveTo() {},
          putImageData() {},
          rect() {},
          restore() {},
          save() {},
          scale() {},
          setLineDash() {},
          setTransform() {},
          stroke() {},
          strokeRect() {},
          translate() {},
        };
      },
      writable: true,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
    const tunnelServer = await startSessionWorkbenchTunnelServer();
    const renderedPage = await renderDashboardPageIntegration({
      handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
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
      },
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

    try {
      const openTerminalButton = await screen.findByRole("button", { name: "Open terminal" });
      await waitFor(() => {
        expect(openTerminalButton).toHaveProperty("disabled", false);
      });

      fireEvent.click(openTerminalButton);

      const sideTerminalPtyOpen = await tunnelServer.waitForPtyOpen((record) => {
        return record.channel.ptySessionId === "terminal";
      });
      expect(sideTerminalPtyOpen.channel.command).toBeUndefined();

      const cliButton = screen.getByRole("button", { name: "CLI" });
      await waitFor(() => {
        expect(cliButton).toHaveProperty("disabled", false);
      });
      fireEvent.click(cliButton);

      const cliPtyOpen = await tunnelServer.waitForPtyOpen((record) => {
        return record.channel.ptySessionId === "cli";
      });
      expect(cliPtyOpen.channel.command).toBe("codex");
      expect(cliPtyOpen.channel.args).toEqual([
        "resume",
        "--remote",
        OpenAiCodexAppServerListenUrl,
        "thread_cli_test",
      ]);

      expect(await screen.findByText("Codex CLI connected")).toBeDefined();
      expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.queryByText("pty session already exists")).toBeNull();
    } finally {
      await renderedPage.close();
      await tunnelServer.close();
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: originalWebSocket,
        writable: true,
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
        writable: true,
      });
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value:
          originalGetContext === undefined
            ? undefined
            : function getContext(
                this: HTMLCanvasElement,
                ...args: Parameters<NonNullable<HTMLCanvasElement["getContext"]>>
              ) {
                return originalGetContext.call(this, ...args);
              },
        writable: true,
      });
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
        writable: true,
      });
    }
  });
});
