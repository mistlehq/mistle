// @vitest-environment jsdom

import { type IncomingMessage, type ServerResponse } from "node:http";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { SessionWorkbenchPage } from "../src/features/pages/session-workbench-page.js";
import { AppShellHeaderActionsContext } from "../src/features/shell/app-shell-header-actions.js";
import { renderDashboardPageIntegration } from "./helpers/dashboard-page.js";

type JsonRpcRequest = {
  id?: string | number;
  method: string;
  params?: unknown;
};

type SocketSender = {
  send: (data: ArrayBufferLike | string) => void;
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

async function selectPrimaryRepositoryOption(optionName: string): Promise<void> {
  const repositoryCombobox = await screen.findByRole("combobox", {
    name: "Primary repository",
  });
  fireEvent.click(repositoryCombobox);
  const repositoryListbox = await screen.findByRole("listbox");
  const repositoryOption = within(repositoryListbox).getByRole("option", {
    name: optionName,
  });
  fireEvent.mouseMove(repositoryOption);
  fireEvent.click(repositoryOption);
}

function getRepositoryBranchElement(branchLabel: string): Element | null {
  const branchElement = document.querySelector("[data-repository-branch-state='present']");

  if (branchElement?.textContent?.trim() !== branchLabel) {
    return null;
  }

  return branchElement;
}

async function startGitBranchTunnelServer(): Promise<{
  close: () => Promise<void>;
  emitTurnCompleted: (turnId: string) => void;
  emitTurnStarted: (turnId: string) => void;
  getBranchCommandCount: () => number;
  getPullRequestCommandCount: () => number;
  failNextGitDirectoryLookup: () => void;
  setGitHubCliAvailabilityForCwd: (cwd: string, isAvailable: boolean) => void;
  setPullRequestForCwd: (
    cwd: string,
    pullRequest: {
      isDraft: boolean;
      number: number;
      state: string;
      title: string;
      url: string;
    } | null,
  ) => void;
  setCurrentBranchForCwd: (cwd: string, branch: string) => void;
  setCurrentBranch: (branch: string) => void;
  url: string;
}> {
  let agentSocket: SocketSender | null = null;
  let agentStreamId: number | null = null;
  let branchCommandCount = 0;
  let pullRequestCommandCount = 0;
  const currentBranchByCwd = new Map<string, string>([
    ["/root/mistlehq/mistle", "main"],
    ["/root/mistlehq/company-os", "company-main"],
    ["/root/mistlehq/e2e-test-repo", "e2e-main"],
  ]);
  const gitHubCliAvailabilityByCwd = new Map<string, boolean>([
    ["/root/mistlehq/mistle", true],
    ["/root/mistlehq/company-os", false],
    ["/root/mistlehq/e2e-test-repo", false],
  ]);
  const pullRequestByCwd = new Map<
    string,
    {
      isDraft: boolean;
      number: number;
      state: string;
      title: string;
      url: string;
    } | null
  >([
    [
      "/root/mistlehq/mistle",
      {
        isDraft: false,
        number: 142,
        state: "OPEN",
        title: "Show pull request status in composer",
        url: "https://github.com/mistlehq/mistle/pull/142",
      },
    ],
    ["/root/mistlehq/company-os", null],
    ["/root/mistlehq/e2e-test-repo", null],
  ]);
  let gitDirectoryLookupFailureCount = 0;
  const gitDir = "/root/mistlehq/mistle/.git";
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
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
          agentSocket = socket;
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
          const args = controlMessage.channel.args ?? [];
          let exitCode = 0;
          let stdout = "";
          let stderr = "";

          if (command === "find") {
            stdout = [
              "/root/mistlehq/company-os/.git",
              "/root/mistlehq/e2e-test-repo/.git",
              "/root/mistlehq/mistle/.git",
            ].join("\n");
          } else if (
            command === "git" &&
            args.length === 2 &&
            args[0] === "branch" &&
            args[1] === "--show-current"
          ) {
            branchCommandCount += 1;
            stdout = `${currentBranchByCwd.get(controlMessage.channel.cwd) ?? ""}\n`;
          } else if (
            command === "git" &&
            args.length === 2 &&
            args[0] === "rev-parse" &&
            args[1] === "--absolute-git-dir"
          ) {
            if (gitDirectoryLookupFailureCount > 0) {
              gitDirectoryLookupFailureCount -= 1;
              exitCode = 124;
              stderr = "command timed out after 5000ms";
            } else {
              stdout = `${gitDir}\n`;
            }
          } else if (command === "gh" && args.length === 1 && args[0] === "--version") {
            if (gitHubCliAvailabilityByCwd.get(controlMessage.channel.cwd) === true) {
              stdout = "gh version 2.76.2\n";
            } else {
              exitCode = 127;
              stderr = "gh: not found";
            }
          } else if (
            command === "gh" &&
            args.length === 4 &&
            args[0] === "pr" &&
            args[1] === "view" &&
            args[2] === "--json" &&
            args[3] === "number,title,url,state,isDraft"
          ) {
            pullRequestCommandCount += 1;
            const pullRequest = pullRequestByCwd.get(controlMessage.channel.cwd) ?? null;
            if (pullRequest === null) {
              exitCode = 1;
              stderr = "no pull requests found for branch";
            } else {
              stdout = `${JSON.stringify(pullRequest)}\n`;
            }
          } else {
            exitCode = 1;
            stderr = `unsupported exec command: ${command} ${args.join(" ")}`.trim();
          }

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
          sendAgentJson({
            id: requestId,
            result: {
              thread: {
                id: `thread_started_${requestParameters.cwd ?? "default"}`,
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

  function sendNotification(payload: unknown): void {
    if (agentSocket === null || agentStreamId === null) {
      throw new Error("Expected an active agent connection.");
    }

    const frame = encodeDataFrame({
      streamId: agentStreamId,
      payloadKind: PayloadKindWebSocketText,
      payload: new TextEncoder().encode(JSON.stringify(payload)),
    });
    agentSocket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
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
    emitTurnCompleted: (turnId: string) => {
      sendNotification({
        method: "turn/completed",
        params: {
          turn: {
            id: turnId,
            status: "completed",
            error: null,
          },
        },
      });
    },
    emitTurnStarted: (turnId: string) => {
      sendNotification({
        method: "turn/started",
        params: {
          turn: {
            id: turnId,
            status: "inProgress",
          },
        },
      });
    },
    getBranchCommandCount: () => branchCommandCount,
    getPullRequestCommandCount: () => pullRequestCommandCount,
    failNextGitDirectoryLookup: () => {
      gitDirectoryLookupFailureCount += 1;
    },
    setGitHubCliAvailabilityForCwd: (cwd: string, isAvailable: boolean) => {
      gitHubCliAvailabilityByCwd.set(cwd, isAvailable);
    },
    setPullRequestForCwd: (cwd: string, pullRequest) => {
      pullRequestByCwd.set(cwd, pullRequest);
    },
    setCurrentBranchForCwd: (cwd: string, branch: string) => {
      currentBranchByCwd.set(cwd, branch);
    },
    setCurrentBranch: (branch: string) => {
      currentBranchByCwd.set("/root/mistlehq/mistle", branch);
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

function createWorkbenchRequestHandler(input: {
  tunnelUrl: string;
}): (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void {
  return (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/instances/sbi_repo_page") {
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
            launchCwd: "/root/mistlehq/mistle/packages/dashboard",
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

describe("SessionWorkbenchPage git branch label", () => {
  afterEach(() => {
    cleanup();
  });

  it("refreshes the branch label after turn completion but not at turn start", async () => {
    const restoreWebSocket = installNodeWebSocket();
    const tunnelServer = await startGitBranchTunnelServer();
    const rendered = await renderDashboardPageIntegration({
      handler: createWorkbenchRequestHandler({
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
      await waitFor(() => {
        expect(getRepositoryBranchElement("main")).toBeTruthy();
      });
      expect(tunnelServer.getBranchCommandCount()).toBe(1);
      expect(tunnelServer.getPullRequestCommandCount()).toBe(1);

      tunnelServer.emitTurnStarted("turn_1");
      await waitFor(() => {
        expect(getRepositoryBranchElement("main")).toBeTruthy();
      });
      expect(tunnelServer.getBranchCommandCount()).toBe(1);
      expect(tunnelServer.getPullRequestCommandCount()).toBe(1);

      tunnelServer.setCurrentBranch("feature/after-turn");
      tunnelServer.setPullRequestForCwd("/root/mistlehq/mistle", {
        isDraft: false,
        number: 143,
        state: "OPEN",
        title: "Refresh composer pull request status after turn completion",
        url: "https://github.com/mistlehq/mistle/pull/143",
      });
      tunnelServer.emitTurnCompleted("turn_1");
      await waitFor(() => {
        expect(getRepositoryBranchElement("feature/after-turn")).toBeTruthy();
      });
      await waitFor(() => {
        expect(screen.getByRole("link", { name: "PR #143" })).toBeTruthy();
      });
      expect(tunnelServer.getBranchCommandCount()).toBe(2);
      expect(tunnelServer.getPullRequestCommandCount()).toBe(2);
    } finally {
      await rendered.close();
      await tunnelServer.close();
      restoreWebSocket();
    }
  }, 45_000);

  it("recovers from a transient git directory lookup failure", async () => {
    const restoreWebSocket = installNodeWebSocket();
    const tunnelServer = await startGitBranchTunnelServer();
    tunnelServer.failNextGitDirectoryLookup();
    const rendered = await renderDashboardPageIntegration({
      handler: createWorkbenchRequestHandler({
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
      await waitFor(() => {
        expect(getRepositoryBranchElement("main")).toBeTruthy();
      });
      expect(tunnelServer.getBranchCommandCount()).toBe(1);
      expect(tunnelServer.getPullRequestCommandCount()).toBe(1);
    } finally {
      await rendered.close();
      await tunnelServer.close();
      restoreWebSocket();
    }
  }, 45_000);

  it("refetches the branch when returning to a previously selected repository", async () => {
    const restoreWebSocket = installNodeWebSocket();
    const tunnelServer = await startGitBranchTunnelServer();
    const rendered = await renderDashboardPageIntegration({
      handler: createWorkbenchRequestHandler({
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
      await waitFor(() => {
        expect(getRepositoryBranchElement("main")).toBeTruthy();
      });
      await selectPrimaryRepositoryOption("mistlehq/company-os");
      await waitFor(() => {
        expect(getRepositoryBranchElement("company-main")).toBeTruthy();
      });
      expect(screen.queryByRole("link", { name: "PR #142" })).toBeNull();

      tunnelServer.setCurrentBranchForCwd("/root/mistlehq/mistle", "feature/returned-repo");
      tunnelServer.setPullRequestForCwd("/root/mistlehq/mistle", {
        isDraft: true,
        number: 144,
        state: "OPEN",
        title: "Show returned repository pull request status",
        url: "https://github.com/mistlehq/mistle/pull/144",
      });
      await selectPrimaryRepositoryOption("mistlehq/mistle");

      await waitFor(() => {
        expect(getRepositoryBranchElement("main")).toBeNull();
      });

      await waitFor(() => {
        expect(getRepositoryBranchElement("feature/returned-repo")).toBeTruthy();
      });
      await waitFor(() => {
        expect(screen.getByRole("link", { name: "PR #144 Draft" })).toBeTruthy();
      });
    } finally {
      await rendered.close();
      await tunnelServer.close();
      restoreWebSocket();
    }
  }, 45_000);

  it("shows only the branch when the GitHub CLI is unavailable", async () => {
    const restoreWebSocket = installNodeWebSocket();
    const tunnelServer = await startGitBranchTunnelServer();
    tunnelServer.setGitHubCliAvailabilityForCwd("/root/mistlehq/mistle", false);
    const rendered = await renderDashboardPageIntegration({
      handler: createWorkbenchRequestHandler({
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
      await waitFor(() => {
        expect(getRepositoryBranchElement("main")).toBeTruthy();
      });
      expect(screen.queryByRole("link", { name: "PR #142" })).toBeNull();
      expect(tunnelServer.getPullRequestCommandCount()).toBe(0);
    } finally {
      await rendered.close();
      await tunnelServer.close();
      restoreWebSocket();
    }
  }, 45_000);
});
