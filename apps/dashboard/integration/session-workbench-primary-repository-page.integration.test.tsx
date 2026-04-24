// @vitest-environment jsdom

import { type IncomingMessage, type ServerResponse } from "node:http";

import { screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import React, { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
} from "../../../packages/sandbox-session-protocol/src/index.ts";
import { NewSessionPage } from "../src/features/pages/new-session-page.js";
import { SessionWorkbenchPage } from "../src/features/pages/session-workbench-page.js";
import { AppShellHeaderActionsContext } from "../src/features/shell/app-shell-header-actions.js";
import { renderDashboardPageIntegration } from "./helpers/dashboard-page.js";

type JsonRpcRequest = {
  id?: string | number;
  method: string;
  params?: unknown;
};

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

function parseJsonRpcRequest(data: RawData): JsonRpcRequest {
  const frame = decodeDataFrame(toUint8Array(data));
  if (frame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error("Expected websocket text frame.");
  }

  return JSON.parse(new TextDecoder().decode(frame.payload)) as JsonRpcRequest;
}

function HeaderActionsHost(input: { children: ReactNode }): React.JSX.Element {
  const [actions, setActions] = useState<ReactNode | null>(null);

  return (
    <AppShellHeaderActionsContext.Provider value={setActions}>
      <div>
        <div data-testid="header-actions-host">{actions}</div>
        {input.children}
      </div>
    </AppShellHeaderActionsContext.Provider>
  );
}

async function startWorkbenchTunnelServer(): Promise<{
  close: () => Promise<void>;
  threadStartCwds: string[];
  url: string;
}> {
  const threadStartCwds: string[] = [];
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    let agentStreamId: number | null = null;

    function sendAgentJson(payload: unknown): void {
      if (agentStreamId === null) {
        throw new Error("Expected agent stream to be open.");
      }

      const frame = encodeDataFrame({
        streamId: agentStreamId,
        payloadKind: PayloadKindWebSocketText,
        payload: new TextEncoder().encode(JSON.stringify(payload)),
      });
      socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    }

    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(data));
        if (controlMessage?.type !== "stream.open") {
          return;
        }

        if (controlMessage.channel.kind === "agent") {
          agentStreamId = controlMessage.streamId;
          socket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId: controlMessage.streamId,
            }),
          );
          return;
        }

        if (controlMessage.channel.kind === "exec") {
          socket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId: controlMessage.streamId,
            }),
          );

          const command = controlMessage.channel.command;
          const stdout =
            command === "find"
              ? [
                  "/root/mistlehq/company-os/.git",
                  "/root/mistlehq/e2e-test-repo/.git",
                  "/root/mistlehq/mistle/.git",
                ].join("\n")
              : command === "pwd"
                ? "/root/mistlehq/mistle\n"
                : "";
          const exitCode = command === "find" || command === "pwd" ? 0 : 1;
          const stderr = exitCode === 0 ? "" : `unsupported exec command: ${command}`;

          socket.send(
            JSON.stringify({
              type: "stream.event",
              streamId: controlMessage.streamId,
              event: {
                type: "exec.result",
                exitCode,
                stdout,
                stderr,
                truncated: false,
              },
            }),
          );
          socket.send(
            JSON.stringify({
              type: "stream.complete",
              streamId: controlMessage.streamId,
            }),
          );
        }

        return;
      }

      const request = parseJsonRpcRequest(data);
      const requestId = request.id ?? 0;

      switch (request.method) {
        case "initialize":
          sendAgentJson({
            id: requestId,
            result: {
              protocolVersion: "2026-03-14",
            },
          });
          return;
        case "initialized":
          return;
        case "thread/list":
          sendAgentJson({
            id: requestId,
            result: {
              data: [],
              nextCursor: null,
            },
          });
          return;
        case "thread/loaded/list":
          sendAgentJson({
            id: requestId,
            result: {
              data: [],
            },
          });
          return;
        case "model/list":
          sendAgentJson({
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
          });
          return;
        case "config/read":
          sendAgentJson({
            id: requestId,
            result: {
              config: {},
            },
          });
          return;
        case "thread/start": {
          const requestParameters =
            request.params !== undefined &&
            request.params !== null &&
            typeof request.params === "object"
              ? (request.params as { cwd?: string })
              : {};
          threadStartCwds.push(requestParameters.cwd ?? "");
          sendAgentJson({
            id: requestId,
            result: {
              thread: {
                id: `thread_started_${String(threadStartCwds.length)}`,
              },
            },
          });
          return;
        }
        default:
          sendAgentJson({
            id: requestId,
            result: {},
          });
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose an address.");
  }

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
    threadStartCwds,
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

function createWorkbenchRequestHandler(input: {
  statusResponses: ReadonlyArray<{
    automationConversation: null;
    connectable: boolean;
    failureCode: null;
    failureMessage: null;
    id: string;
    runtimeContext: {
      launchCwd: string | null;
      primaryRepositoryRoot: string | null;
    } | null;
    status: "running";
    title: string;
  }>;
  tunnelUrl: string;
}): (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void {
  let statusRequestCount = 0;

  return (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/instances/sbi_repo_page") {
      const statusResponse =
        input.statusResponses[Math.min(statusRequestCount, input.statusResponses.length - 1)];
      statusRequestCount += 1;

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(statusResponse));
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/sandbox/instances/sbi_repo_page/connection-tokens"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          instanceId: "sbi_repo_page",
          url: input.tunnelUrl,
          token: "tok_repo_page",
          expiresAt: "2026-03-31T00:00:00.000Z",
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  };
}

describe("SessionWorkbenchPage primary repository", () => {
  afterEach(() => {
    cleanup();
  });

  it("enables and populates the primary repository selector when the workbench is ready", async () => {
    const restoreWebSocket = installNodeWebSocket();
    const tunnelServer = await startWorkbenchTunnelServer();
    const rendered = await renderDashboardPageIntegration({
      handler: createWorkbenchRequestHandler({
        statusResponses: [
          {
            id: "sbi_repo_page",
            title: "Repo Page Test Session",
            status: "running",
            connectable: true,
            failureCode: null,
            failureMessage: null,
            runtimeContext: {
              launchCwd: "/root/mistlehq/mistle/packages/dashboard",
              primaryRepositoryRoot: "/root/mistlehq/mistle",
            },
            automationConversation: null,
          },
        ],
        tunnelUrl: tunnelServer.url,
      }),
      ui: (
        <HeaderActionsHost>
          <MemoryRouter initialEntries={["/sessions/sbi_repo_page"]}>
            <Routes>
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </HeaderActionsHost>
      ),
    });

    try {
      await waitFor(
        () => {
          const combobox = screen.getByRole("combobox", { name: "Primary repository" });
          expect(combobox.getAttribute("data-disabled")).toBeNull();
          expect(combobox.textContent).toContain("mistlehq/mistle");
        },
        { timeout: 40_000 },
      );
    } finally {
      await rendered.close();
      await tunnelServer.close();
      restoreWebSocket();
    }
  }, 45_000);

  it("keeps the selected repository through the new-session launch redirect", async () => {
    const restoreWebSocket = installNodeWebSocket();
    const tunnelServer = await startWorkbenchTunnelServer();
    let observedPrimaryRepositoryId: string | null = null;
    const rendered = await renderDashboardPageIntegration({
      handler: (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/profiles/launchable") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [
                {
                  id: "sbp_profile_alpha",
                  organizationId: "org_123",
                  displayName: "Alpha Profile",
                  status: "active",
                  activeVersion: 1,
                  latestVersion: 1,
                  createdAt: "2026-03-01T00:00:00.000Z",
                  updatedAt: "2026-03-01T00:00:00.000Z",
                  repositoryOptions: [
                    {
                      id: "mistlehq/company-os",
                      label: "mistlehq/company-os",
                      path: "/root/mistlehq/company-os",
                    },
                    {
                      id: "mistlehq/mistle",
                      label: "mistlehq/mistle",
                      path: "/root/mistlehq/mistle",
                    },
                  ],
                },
              ],
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          requestUrl.pathname === "/v1/sandbox/profiles/sbp_profile_alpha/versions/1/instances"
        ) {
          let requestBody = "";
          request.on("data", (chunk) => {
            requestBody += String(chunk);
          });
          request.on("end", () => {
            observedPrimaryRepositoryId =
              (JSON.parse(requestBody) as { primaryRepositoryId: string | null })
                .primaryRepositoryId ?? null;
            response.writeHead(201, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                status: "accepted",
                workflowRunId: "wrf_repo_page",
                sandboxInstanceId: "sbi_repo_page",
              }),
            );
          });
          return;
        }

        if (
          request.method === "GET" &&
          requestUrl.pathname === "/v1/sandbox/instances/sbi_repo_page"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              id: "sbi_repo_page",
              title: "Repo Page Test Session",
              status: "running",
              connectable: true,
              failureCode: null,
              failureMessage: null,
              runtimeContext: {
                launchCwd: "/root/mistlehq/mistle",
                primaryRepositoryRoot: "/root/mistlehq/mistle",
              },
              automationConversation: null,
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          requestUrl.pathname === "/v1/sandbox/instances/sbi_repo_page/connection-tokens"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              instanceId: "sbi_repo_page",
              url: tunnelServer.url,
              token: "tok_repo_page",
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
          <MemoryRouter initialEntries={["/sessions/new"]}>
            <Routes>
              <Route
                element={<NewSessionPage initialSelectedProfileId="sbp_profile_alpha" />}
                path="/sessions/new"
              />
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </HeaderActionsHost>
      ),
    });

    try {
      const primaryRepositoryCombobox = await screen.findByRole("combobox", {
        name: "Primary repository",
      });
      await waitFor(() => {
        expect(primaryRepositoryCombobox).toHaveProperty("disabled", false);
      });
      fireEvent.focus(primaryRepositoryCombobox);
      const primaryRepositoryListbox = await screen.findByRole("listbox");
      fireEvent.click(
        within(primaryRepositoryListbox).getByRole("option", { name: "mistlehq/mistle" }),
      );
      fireEvent.blur(primaryRepositoryCombobox);
      fireEvent.click(screen.getByRole("button", { name: "Start session" }));

      await waitFor(
        () => {
          expect(observedPrimaryRepositoryId).toBe("mistlehq/mistle");
          expect(
            screen.getByRole("combobox", { name: "Primary repository" }).textContent,
          ).toContain("mistlehq/mistle");
        },
        { timeout: 40_000 },
      );
    } finally {
      await rendered.close();
      await tunnelServer.close();
      restoreWebSocket();
    }
  }, 45_000);
});
