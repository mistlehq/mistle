import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { AgentStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";

export type ClaudeCodeThreadStatus = "active" | "error" | "idle" | "notLoaded";

export type ClaudeCodeThreadTurn = {
  executionId: string;
  message: unknown;
};

export type ClaudeCodeThreadReadResult = {
  thread: {
    activeTurnId: string | null;
    id: string;
    lastError: string | null;
    status: {
      type: ClaudeCodeThreadStatus;
    };
    turns: readonly ClaudeCodeThreadTurn[];
  };
};

export type ClaudeCodeSessionClient = {
  close(): void;
  connect(): Promise<void>;
  createThread(input?: {
    cwd?: string | null;
    idempotency?: AgentConversationIdempotencyMetadata;
  }): Promise<{ threadId: string }>;
  interruptTurn(input: { threadId: string }): Promise<void>;
  readThread(input: { threadId: string }): Promise<ClaudeCodeThreadReadResult>;
  resumeThread(input: { threadId: string }): Promise<void>;
  startTurn(input: {
    idempotency?: AgentConversationIdempotencyMetadata;
    inputText: string;
    threadId: string;
  }): Promise<{ turnId: string }>;
  steerTurn(input: {
    idempotency?: AgentConversationIdempotencyMetadata;
    inputText: string;
    threadId: string;
  }): Promise<{ turnId: string }>;
};

export type ClaudeCodeSessionClientInput = {
  transport: SandboxSessionTransport;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedRecord(value: unknown, path: readonly string[]): Record<string, unknown> | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return isRecord(currentValue) ? currentValue : null;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }
  return typeof currentValue === "string" && currentValue.length > 0 ? currentValue : null;
}

function extractThreadId(result: unknown, method: string): string {
  const threadId = readNestedString(result, ["thread", "id"]);
  if (threadId === null) {
    throw new Error(`Claude Code ${method} response did not include thread.id.`);
  }
  return threadId;
}

function extractTurnId(result: unknown, method: string): string {
  const turnId = readNestedString(result, ["turn", "id"]) ?? readNestedString(result, ["turnId"]);
  if (turnId === null) {
    throw new Error(`Claude Code ${method} response did not include turn id.`);
  }
  return turnId;
}

function normalizeClaudeCodeThreadStatus(value: string | null): ClaudeCodeThreadStatus {
  switch (value) {
    case "active":
    case "error":
    case "idle":
    case "notLoaded":
      return value;
    default:
      throw new Error("Claude Code thread/read response did not include supported status.");
  }
}

function parseClaudeCodeThreadReadResult(result: unknown): ClaudeCodeThreadReadResult {
  const thread = readNestedRecord(result, ["thread"]);
  if (thread === null) {
    throw new Error("Claude Code thread/read response did not include thread.");
  }
  const threadId = readNestedString(result, ["thread", "id"]);
  if (threadId === null) {
    throw new Error("Claude Code thread/read response did not include thread.id.");
  }
  const rawTurns = thread["turns"];
  if (!Array.isArray(rawTurns)) {
    throw new Error("Claude Code thread/read response did not include thread.turns.");
  }

  return {
    thread: {
      id: threadId,
      status: {
        type: normalizeClaudeCodeThreadStatus(
          readNestedString(result, ["thread", "status", "type"]),
        ),
      },
      activeTurnId: readNestedString(result, ["thread", "activeTurnId"]),
      turns: rawTurns.map((turn, index) => ({
        executionId: isRecord(turn)
          ? (readNestedString(turn, ["executionId"]) ?? `turn_${String(index)}`)
          : `turn_${String(index)}`,
        message: isRecord(turn) ? turn["message"] : turn,
      })),
      lastError:
        typeof thread["lastError"] === "string" && thread["lastError"].length > 0
          ? thread["lastError"]
          : null,
    },
  };
}

export function createClaudeCodeSessionClient(
  input: ClaudeCodeSessionClientInput,
): ClaudeCodeSessionClient {
  const agentStream = new AgentStreamClient({
    transport: input.transport,
  });
  const rpcClient = new ClaudeCodeJsonRpcClient(agentStream);

  return {
    close() {
      rpcClient.dispose();
      agentStream.dispose();
    },
    async connect() {
      await agentStream.connect();
      await rpcClient.initialize();
    },
    async createThread(createInput = {}) {
      const result = await rpcClient.call(
        "thread/start",
        createInput.cwd === undefined || createInput.cwd === null ? {} : { cwd: createInput.cwd },
        {
          idempotency: createInput.idempotency,
        },
      );
      return {
        threadId: extractThreadId(result, "thread/start"),
      };
    },
    async interruptTurn(interruptInput) {
      await rpcClient.call("turn/interrupt", {
        threadId: interruptInput.threadId,
      });
    },
    async readThread(readInput) {
      const result = await rpcClient.call("thread/read", {
        threadId: readInput.threadId,
      });
      return parseClaudeCodeThreadReadResult(result);
    },
    async resumeThread(resumeInput) {
      await rpcClient.call("thread/resume", {
        threadId: resumeInput.threadId,
      });
    },
    async startTurn(startInput) {
      const result = await rpcClient.call(
        "turn/start",
        {
          threadId: startInput.threadId,
          inputText: startInput.inputText,
        },
        {
          idempotency: startInput.idempotency,
        },
      );
      return {
        turnId: extractTurnId(result, "turn/start"),
      };
    },
    async steerTurn(steerInput) {
      const result = await rpcClient.call(
        "turn/steer",
        {
          threadId: steerInput.threadId,
          inputText: steerInput.inputText,
        },
        {
          idempotency: steerInput.idempotency,
        },
      );
      return {
        turnId: extractTurnId(result, "turn/steer"),
      };
    },
  };
}
