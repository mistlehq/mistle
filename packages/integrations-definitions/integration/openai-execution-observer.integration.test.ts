import { once } from "node:events";

import {
  AgentExecutionObservationTypes,
  type AgentExecutionObservation,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { createOpenAiExecutionObserver } from "../src/openai/variants/openai-default/agent/execution-observer.server.js";

type CodexConnectionScript = (socket: WebSocket) => Promise<void>;

class JsonMessageQueue {
  readonly #messages: Array<Record<string, unknown>> = [];
  readonly #pendingResolvers: Array<(message: Record<string, unknown>) => void> = [];
  readonly #pendingRejectors: Array<(error: Error) => void> = [];
  #failure: Error | undefined;

  constructor(socket: WebSocket) {
    socket.on("message", (data: RawData) => {
      const parsedMessage = parseJsonMessage(rawDataToText(data));
      const resolve = this.#pendingResolvers.shift();
      const reject = this.#pendingRejectors.shift();
      if (resolve === undefined || reject === undefined) {
        this.#messages.push(parsedMessage);
        return;
      }

      resolve(parsedMessage);
    });
    socket.once("error", (error: Error) => {
      this.#fail(error);
    });
    socket.once("close", () => {
      this.#fail(new Error("websocket closed while awaiting a JSON message"));
    });
  }

  next(): Promise<Record<string, unknown>> {
    const nextMessage = this.#messages.shift();
    if (nextMessage !== undefined) {
      return Promise.resolve(nextMessage);
    }
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure);
    }

    return awaitJsonMessage(this.#pendingResolvers, this.#pendingRejectors);
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) {
      return;
    }

    this.#failure = error;
    while (this.#pendingRejectors.length > 0) {
      const reject = this.#pendingRejectors.shift();
      this.#pendingResolvers.shift();
      reject?.(error);
    }
  }
}

function isActiveObservation(
  observation: AgentExecutionObservation,
): observation is Extract<AgentExecutionObservation, { type: "active" }> {
  return observation.type === AgentExecutionObservationTypes.ACTIVE;
}

function readListeningPort(server: WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("websocket server address must be available");
  }

  return address.port;
}

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

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function awaitJsonMessage(
  resolvers: Array<(message: Record<string, unknown>) => void>,
  rejectors: Array<(error: Error) => void>,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    resolvers.push(resolve);
    rejectors.push(reject);
  });
}

function parseJsonMessage(payload: string): Record<string, unknown> {
  const parsedPayload: unknown = JSON.parse(payload);
  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("expected websocket JSON object");
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

async function writeJsonMessage(socket: WebSocket, payload: object): Promise<void> {
  const message = JSON.stringify(payload);
  await new Promise<void>((resolve, reject) => {
    socket.send(message, (error?: Error | null) => {
      if (error == null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function createCodexServer(scripts: readonly CodexConnectionScript[]): Promise<{
  server: WebSocketServer;
  url: string;
}> {
  const server = new WebSocketServer({
    port: 0,
  });
  await once(server, "listening");

  let connectionIndex = 0;
  server.on("connection", (socket) => {
    const script = scripts[connectionIndex];
    connectionIndex += 1;
    if (script === undefined) {
      socket.close();
      return;
    }

    void script(socket).catch(() => {
      void closeWebSocket(socket).catch(() => undefined);
    });
  });

  return {
    server,
    url: `ws://127.0.0.1:${String(readListeningPort(server))}`,
  };
}

async function completeInitializeHandshake(
  messages: JsonMessageQueue,
  socket: WebSocket,
): Promise<void> {
  const initializeRequest = await messages.next();
  expect(initializeRequest.method).toBe("initialize");
  expect(initializeRequest.id).toBe("1");

  await writeJsonMessage(socket, {
    id: initializeRequest.id,
    result: {
      userAgent: "codex-app-server",
    },
  });

  const initializedNotification = await messages.next();
  expect(initializedNotification.method).toBe("initialized");
}

describe("OpenAI execution observer polling", () => {
  it("polls Codex turn state and resumes not-loaded threads", async () => {
    const { server, url } = await createCodexServer([
      async (socket) => {
        const messages = new JsonMessageQueue(socket);
        await completeInitializeHandshake(messages, socket);

        const threadReadRequest = await messages.next();
        expect(threadReadRequest.method).toBe("thread/read");
        await writeJsonMessage(socket, {
          id: threadReadRequest.id,
          error: {
            code: -32600,
            message: "thread not loaded: thr_resume",
          },
        });

        const threadResumeRequest = await messages.next();
        expect(threadResumeRequest.method).toBe("thread/resume");
        await writeJsonMessage(socket, {
          id: threadResumeRequest.id,
          result: {
            thread: {
              id: "thr_resume",
            },
          },
        });

        const resumedThreadReadRequest = await messages.next();
        expect(resumedThreadReadRequest.method).toBe("thread/read");
        await writeJsonMessage(socket, {
          id: resumedThreadReadRequest.id,
          result: {
            thread: {
              id: "thr_resume",
              turns: [
                {
                  id: "turn_resume",
                  status: "inProgress",
                },
              ],
            },
          },
        });
      },
      async (socket) => {
        const messages = new JsonMessageQueue(socket);
        await completeInitializeHandshake(messages, socket);

        const threadReadRequest = await messages.next();
        expect(threadReadRequest.method).toBe("thread/read");
        await writeJsonMessage(socket, {
          id: threadReadRequest.id,
          result: {
            thread: {
              id: "thr_resume",
              turns: [
                {
                  id: "turn_resume",
                  status: "completed",
                },
              ],
            },
          },
        });
      },
    ]);

    try {
      const observer = createOpenAiExecutionObserver();
      const session = observer.createSession({
        transportUrl: url,
      });
      session.onOutboundMessage(
        JSON.stringify({
          id: "request_1",
          method: "turn/start",
          params: {
            threadId: "thr_resume",
            input: [],
          },
        }),
      );
      session.onInboundMessage(
        JSON.stringify({
          id: "request_1",
          result: {
            turn: {
              id: "turn_resume",
              status: "inProgress",
            },
          },
        }),
      );

      const [observation] = session.drainObservations().filter(isActiveObservation);
      expect(observation).toBeDefined();
      if (observation === undefined) {
        throw new Error("execution observation is required");
      }

      await expect(observation.poll()).resolves.toBe("active");
      await expect(observation.poll()).resolves.toBe("terminal");
    } finally {
      await closeWebSocketServer(server);
    }
  }, 15_000);
});
