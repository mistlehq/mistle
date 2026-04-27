import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import {
  buildCodexConversationTitleGenerationPrompt,
  generateConversationTitleWithSandboxCodexExec,
  parseCodexConversationTitleGenerationOutput,
} from "./title-generation.js";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type TestServer = {
  close: () => Promise<void>;
  openRequest: Promise<string>;
  sendResult: (input: {
    exitCode: number;
    stderr: string;
    stdout: string;
    truncated: boolean;
  }) => void;
  url: string;
};

const openServers = new Set<TestServer>();

const RenderedAutomationInput = "Investigate this failed deploy and summarize the root cause.";

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
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

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON object payload.");
  }

  return Object.fromEntries(Object.entries(value));
}

async function startExecTitleServer(): Promise<TestServer> {
  const openRequestDeferred = createDeferred<string>();
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error: Error) => reject(error));
  });

  let activeStreamId: number | null = null;
  let connectedSocket: NodeWebSocket | null = null;

  wsServer.on("connection", (socket) => {
    connectedSocket = socket;

    socket.on("message", (message) => {
      const payload = expectRecord(parseJson(toText(message)));
      if (payload.type !== "stream.open" || typeof payload.streamId !== "number") {
        return;
      }

      activeStreamId = payload.streamId;
      openRequestDeferred.resolve(JSON.stringify(payload));
      socket.send(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: payload.streamId,
        }),
      );
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    close: async () => {
      connectedSocket?.close();
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
    openRequest: openRequestDeferred.promise,
    sendResult: (input) => {
      if (connectedSocket === null || activeStreamId === null) {
        throw new Error("Expected exec stream to be open before sending result.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.event",
          streamId: activeStreamId,
          event: {
            type: "exec.result",
            exitCode: input.exitCode,
            stdout: input.stdout,
            stderr: input.stderr,
            truncated: input.truncated,
          },
        }),
      );
      connectedSocket.send(
        JSON.stringify({
          type: "stream.complete",
          streamId: activeStreamId,
        }),
      );
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("buildCodexConversationTitleGenerationPrompt", () => {
  it("uses the delivered input as the title source", () => {
    const prompt = buildCodexConversationTitleGenerationPrompt(RenderedAutomationInput);

    expect(prompt).toContain("Investigate this failed deploy");
    expect(prompt).not.toContain("Webhook context:");
  });
});

describe("parseCodexConversationTitleGenerationOutput", () => {
  it("normalizes whitespace and strips trailing punctuation", () => {
    expect(
      parseCodexConversationTitleGenerationOutput('{"title":"  Failed   deploy triage! "}'),
    ).toBe("Failed deploy triage");
  });

  it("rejects non-JSON output", () => {
    expect(() => parseCodexConversationTitleGenerationOutput("Failed deploy triage")).toThrow(
      "Codex conversation title generation returned output that is not valid JSON.",
    );
  });
});

describe("generateConversationTitleWithSandboxCodexExec", () => {
  it("runs Codex non-interactively through sandbox exec stdin", async () => {
    const server = await startExecTitleServer();
    openServers.add(server);

    const titlePromise = generateConversationTitleWithSandboxCodexExec({
      connectionUrl: server.url,
      inputText: RenderedAutomationInput,
    });

    const openRequest = await server.openRequest;
    expect(openRequest).toContain('"kind":"exec"');
    expect(openRequest).toContain('"command":"sh"');
    expect(openRequest).toContain("codex exec --ephemeral");
    expect(openRequest).toContain("--model gpt-5.4-mini");
    expect(openRequest).toContain("model_reasoning_effort=");
    expect(openRequest).toContain("low");
    expect(openRequest).toContain("Investigate this failed deploy");

    server.sendResult({
      exitCode: 0,
      stdout: '{"title":" Failed deploy triage. "}',
      stderr: "",
      truncated: false,
    });

    await expect(titlePromise).resolves.toBe("Failed deploy triage");
  });
});
