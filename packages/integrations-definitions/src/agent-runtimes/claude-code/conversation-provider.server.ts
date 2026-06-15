import type {
  AgentConversationConnection,
  AgentConversationInspectResult,
  AgentConversationProvider,
} from "@mistle/integrations-core";
import { AgentConversationStatuses } from "@mistle/integrations-core";
import { AgentStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";

type ClaudeCodeConnection = {
  rpcClient: ClaudeCodeJsonRpcClient;
  sessionClient: AgentStreamClient;
  transport: SandboxSessionTransport;
};

const ClaudeCodeConnections = new WeakMap<AgentConversationConnection, ClaudeCodeConnection>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function getClaudeCodeConnection(connection: AgentConversationConnection): ClaudeCodeConnection {
  const claudeCodeConnection = ClaudeCodeConnections.get(connection);
  if (claudeCodeConnection === undefined) {
    throw new Error("Claude Code conversation provider received an unknown connection.");
  }
  return claudeCodeConnection;
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

function normalizeThreadStatus(value: unknown): AgentConversationInspectResult["status"] {
  const statusType = readNestedString(value, ["thread", "status", "type"]);
  switch (statusType) {
    case "active":
      return AgentConversationStatuses.ACTIVE;
    case "idle":
      return AgentConversationStatuses.IDLE;
    case "notLoaded":
      return AgentConversationStatuses.NOT_LOADED;
    case "error":
      return AgentConversationStatuses.ERROR;
    default:
      throw new Error(
        "Claude Code thread/read response did not include supported thread.status.type.",
      );
  }
}

function readActiveExecutionId(value: unknown): string | null {
  return readNestedString(value, ["thread", "activeTurnId"]);
}

function extractGeneratedTitle(result: unknown): string {
  const title = readNestedString(result, ["title"]);
  if (title === null) {
    throw new Error("Claude Code title/generate response did not include title.");
  }
  return title;
}

async function connectClaudeCodeConversationProvider(input: {
  connectionUrl: string;
  connectTimeoutMs?: number;
}): Promise<AgentConversationConnection> {
  const runtime = createNodeSandboxSessionRuntime();
  const transport = new SandboxSessionTransport({
    runtime,
    ...(input.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: input.connectTimeoutMs }),
  });
  await transport.connect({
    connectionUrl: input.connectionUrl,
  });

  const sessionClient = new AgentStreamClient({
    transport,
  });
  await sessionClient.connect();

  const rpcClient = new ClaudeCodeJsonRpcClient(sessionClient);
  await rpcClient.initialize();

  const connection: AgentConversationConnection = {
    request: async (requestInput) =>
      await rpcClient.call(requestInput.method, requestInput.params, {
        idempotency: requestInput.idempotency,
      }),
    notify: async (notificationInput) => {
      await rpcClient.notify(notificationInput.method, notificationInput.params);
    },
    close: async () => {
      rpcClient.dispose();
      sessionClient.dispose();
      transport.disconnect(1000, "Claude Code conversation provider closed");
      ClaudeCodeConnections.delete(connection);
    },
  };

  ClaudeCodeConnections.set(connection, {
    rpcClient,
    sessionClient,
    transport,
  });
  return connection;
}

export function createClaudeCodeConversationProvider(): AgentConversationProvider {
  return {
    connect: connectClaudeCodeConversationProvider,
    createConversation: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      const result = await claudeCodeConnection.rpcClient.call(
        "thread/start",
        {
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.options === undefined ? {} : { options: input.options }),
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerConversationId: extractThreadId(result, "thread/start"),
      };
    },
    resumeConversation: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      await claudeCodeConnection.rpcClient.call("thread/resume", {
        threadId: input.providerConversationId,
      });
    },
    inspectConversation: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      const result = await claudeCodeConnection.rpcClient.call("thread/read", {
        threadId: input.providerConversationId,
      });
      return {
        exists: true,
        status: normalizeThreadStatus(result),
        activeExecutionId: readActiveExecutionId(result),
      };
    },
    generateConversationTitle: async (input) => {
      const connection = await connectClaudeCodeConversationProvider({
        connectionUrl: input.connectionUrl,
      });
      try {
        const claudeCodeConnection = getClaudeCodeConnection(connection);
        const result = await claudeCodeConnection.rpcClient.call("title/generate", {
          inputText: input.inputText,
          threadId: input.providerConversationId,
        });
        return {
          title: extractGeneratedTitle(result),
        };
      } finally {
        await connection.close();
      }
    },
    startExecution: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      const result = await claudeCodeConnection.rpcClient.call(
        "turn/start",
        {
          threadId: input.providerConversationId,
          inputText: input.inputText,
          ...(input.collaborationModeSettings === undefined
            ? {}
            : { collaborationModeSettings: input.collaborationModeSettings }),
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractTurnId(result, "turn/start"),
      };
    },
    steerExecution: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      const result = await claudeCodeConnection.rpcClient.call(
        "turn/steer",
        {
          threadId: input.providerConversationId,
          expectedTurnId: input.providerExecutionId,
          inputText: input.inputText,
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractTurnId(result, "turn/steer"),
      };
    },
    submitAssociatedResourceDelivery: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      const result = await claudeCodeConnection.rpcClient.call(
        "turn/start",
        {
          threadId: input.providerConversationId,
          inputText: input.inputText,
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractTurnId(result, "turn/start"),
      };
    },
    interruptExecution: async (input) => {
      const claudeCodeConnection = getClaudeCodeConnection(input.connection);
      await claudeCodeConnection.rpcClient.call("turn/interrupt", {
        threadId: input.providerConversationId,
        turnId: input.providerExecutionId,
      });
    },
  };
}
