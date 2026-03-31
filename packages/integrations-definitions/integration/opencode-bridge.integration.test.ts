import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import { systemSleeper } from "@mistle/time";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { renderOpencodeBridgeScript } from "../src/agent-runtimes/opencode/bridge-script.js";

type SessionStatusInfo = {
  type: "idle" | "busy" | "retry";
};

function rawDataToText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return data.toString("utf8");
}

function parseJsonMessage(payload: string): Record<string, unknown> {
  const parsedPayload: unknown = JSON.parse(payload);
  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("expected websocket JSON object");
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(value));
}

function readProviderExecutionId(value: unknown): string {
  const record = readObject(value);
  if (record === undefined) {
    throw new Error("expected execution result object");
  }

  const providerExecutionId = record.providerExecutionId;
  if (typeof providerExecutionId !== "string" || providerExecutionId.length === 0) {
    throw new Error("expected execution result to include providerExecutionId");
  }

  return providerExecutionId;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body.length === 0 ? undefined : JSON.parse(body);
}

async function connectWebSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await once(socket, "open");
  return socket;
}

async function waitForWebSocketServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const socket = await connectWebSocket(url);
      await closeWebSocket(socket);
      return;
    } catch {
      await systemSleeper.sleep(50);
    }
  }

  throw new Error(`timed out after ${String(timeoutMs)}ms waiting for websocket server at ${url}`);
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
}

async function sendJsonRequest(input: {
  socket: WebSocket;
  id: string;
  method: string;
  params?: unknown;
}): Promise<Record<string, unknown>> {
  const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    const handleMessage = (data: RawData): void => {
      try {
        resolve(parseJsonMessage(rawDataToText(data)));
      } catch (error) {
        reject(error);
      } finally {
        input.socket.off("message", handleMessage);
      }
    };
    input.socket.on("message", handleMessage);
  });

  await new Promise<void>((resolve, reject) => {
    input.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: input.id,
        method: input.method,
        ...(input.params === undefined ? {} : { params: input.params }),
      }),
      (error) => {
        if (error == null) {
          resolve();
          return;
        }

        reject(error);
      },
    );
  });

  return await responsePromise;
}

function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function closeChildProcess(process: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.exitCode !== null || process.killed) {
      resolve();
      return;
    }

    process.once("exit", () => resolve());
    process.kill("SIGTERM");
  });
}

describe("OpenCode bridge integration", () => {
  it("translates websocket RPC calls into Opencode HTTP routes", async () => {
    let sessionExists = true;
    let sessionStatusById: Record<string, SessionStatusInfo> = {
      ses_123: {
        type: "busy",
      },
    };
    const promptBodies: unknown[] = [];
    let abortCount = 0;

    const opencodeServer = createServer(
      async (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");

        if (request.method === "POST" && url.pathname === "/session") {
          response.writeHead(200, {
            "content-type": "application/json",
          });
          response.end(
            JSON.stringify({
              id: "ses_123",
              directory: "/workspace",
              title: "New session",
              version: "1",
              slug: "new-session",
              projectID: "proj_123",
              time: {
                created: 1,
                updated: 1,
              },
            }),
          );
          return;
        }

        if (request.method === "GET" && url.pathname === "/session/status") {
          response.writeHead(200, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(sessionStatusById));
          return;
        }

        if (request.method === "GET" && url.pathname === "/session/ses_123") {
          if (!sessionExists) {
            response.writeHead(404, {
              "content-type": "application/json",
            });
            response.end(JSON.stringify({ error: "not found" }));
            return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
          });
          response.end(
            JSON.stringify({
              id: "ses_123",
              directory: "/workspace",
              title: "Session 123",
              version: "1",
              slug: "session-123",
              projectID: "proj_123",
              time: {
                created: 1,
                updated: 2,
              },
            }),
          );
          return;
        }

        if (request.method === "POST" && url.pathname === "/session/ses_123/prompt_async") {
          promptBodies.push(await readJsonBody(request));
          response.writeHead(204);
          response.end();
          return;
        }

        if (request.method === "POST" && url.pathname === "/session/ses_123/abort") {
          abortCount += 1;
          response.writeHead(200, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(true));
          return;
        }

        response.writeHead(404, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ error: "unhandled path", path: url.pathname }));
      },
    );

    opencodeServer.listen(0, "127.0.0.1");
    await once(opencodeServer, "listening");
    const opencodeAddress = opencodeServer.address();
    if (opencodeAddress === null || typeof opencodeAddress === "string") {
      throw new Error("expected Opencode test server address");
    }

    const bridgeServer = createServer();
    bridgeServer.listen(0, "127.0.0.1");
    await once(bridgeServer, "listening");
    const bridgeAddress = bridgeServer.address();
    if (bridgeAddress === null || typeof bridgeAddress === "string") {
      throw new Error("expected bridge listen address");
    }
    await closeHttpServer(bridgeServer);

    const bridgeDir = await mkdtemp(
      path.join(
        "/Users/thomasjiang/Projects/mistle-opencode-pr8/packages/integrations-definitions",
        ".tmp-opencode-bridge-",
      ),
    );
    const bridgeScriptPath = path.join(bridgeDir, "bridge.mjs");
    await writeFile(
      bridgeScriptPath,
      renderOpencodeBridgeScript({
        listenUrl: `ws://127.0.0.1:${String(bridgeAddress.port)}`,
        opencodeBaseUrl: `http://127.0.0.1:${String(opencodeAddress.port)}`,
      }),
      "utf8",
    );

    const bridgeProcess = spawn("node", [bridgeScriptPath], {
      cwd: "/Users/thomasjiang/Projects/mistle-opencode-pr8",
      stdio: "pipe",
    });

    try {
      const bridgeUrl = `ws://127.0.0.1:${String(bridgeAddress.port)}`;
      await Promise.race([
        waitForWebSocketServer(bridgeUrl, 10_000),
        new Promise<never>((_, reject) => {
          bridgeProcess.once("exit", (code) => {
            reject(new Error(`bridge exited before ready with code ${String(code)}`));
          });
          bridgeProcess.stderr.once("data", (chunk: Buffer) => {
            reject(new Error(`bridge stderr before ready: ${chunk.toString("utf8")}`));
          });
        }),
      ]);

      const socket = await connectWebSocket(bridgeUrl);
      try {
        const createResponse = await sendJsonRequest({
          socket,
          id: "1",
          method: "conversation.create",
          params: {
            options: {},
          },
        });
        expect(createResponse.result).toEqual({
          providerConversationId: "ses_123",
          providerState: expect.objectContaining({
            id: "ses_123",
          }),
        });

        const startResponse = await sendJsonRequest({
          socket,
          id: "2",
          method: "execution.start",
          params: {
            providerConversationId: "ses_123",
            inputText: "Summarize the repository",
          },
        });
        const providerExecutionId = readProviderExecutionId(startResponse.result);
        expect(providerExecutionId).toMatch(/^opx_/);
        expect(promptBodies).toEqual([
          {
            parts: [
              {
                type: "text",
                text: "Summarize the repository",
              },
            ],
          },
        ]);

        const inspectBusyResponse = await sendJsonRequest({
          socket,
          id: "3",
          method: "conversation.inspect",
          params: {
            providerConversationId: "ses_123",
          },
        });
        expect(inspectBusyResponse.result).toEqual({
          exists: true,
          status: "active",
          activeExecutionId: providerExecutionId,
        });

        sessionStatusById = {
          ses_123: {
            type: "idle",
          },
        };

        const inspectIdleResponse = await sendJsonRequest({
          socket,
          id: "4",
          method: "conversation.inspect",
          params: {
            providerConversationId: "ses_123",
          },
        });
        expect(inspectIdleResponse.result).toEqual({
          exists: true,
          status: "idle",
          activeExecutionId: null,
        });

        const interruptResponse = await sendJsonRequest({
          socket,
          id: "5",
          method: "execution.interrupt",
          params: {
            providerConversationId: "ses_123",
            providerExecutionId,
          },
        });
        expect(interruptResponse.result).toBe(true);
        expect(abortCount).toBe(1);

        sessionExists = false;
        const missingResponse = await sendJsonRequest({
          socket,
          id: "6",
          method: "conversation.inspect",
          params: {
            providerConversationId: "ses_123",
          },
        });
        expect(missingResponse.result).toEqual({
          exists: false,
          status: "idle",
          activeExecutionId: null,
        });
      } finally {
        await closeWebSocket(socket);
      }
    } finally {
      await closeChildProcess(bridgeProcess);
      await rm(bridgeDir, {
        force: true,
        recursive: true,
      });
      await closeHttpServer(opencodeServer);
    }
  });
});
