import type {
  AgentConversationConnection,
  AgentConversationInspectResult,
  AgentConversationProvider,
} from "@mistle/integrations-core";
import { AgentConversationStatuses } from "@mistle/integrations-core";
import { AgentStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";

const ClaudeCodeConnections = new WeakMap<AgentConversationConnection, ClaudeCodeJsonRpcClient>();

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

function getClaudeCodeClient(connection: AgentConversationConnection): ClaudeCodeJsonRpcClient {
  const claudeCodeClient = ClaudeCodeConnections.get(connection);
  if (claudeCodeClient === undefined) {
    throw new Error("Claude Code conversation provider received an unknown connection.");
  }
  return claudeCodeClient;
}

function extractSessionId(result: unknown, method: string): string {
  const sessionId = readNestedString(result, ["session", "id"]);
  if (sessionId === null) {
    throw new Error(`Claude Code ${method} response did not include session.id.`);
  }
  return sessionId;
}

function extractQueryId(result: unknown, method: string): string {
  const queryId =
    readNestedString(result, ["query", "id"]) ?? readNestedString(result, ["queryId"]);
  if (queryId === null) {
    throw new Error(`Claude Code ${method} response did not include query id.`);
  }
  return queryId;
}

function normalizeSessionStatus(value: unknown): AgentConversationInspectResult["status"] {
  const statusType = readNestedString(value, ["session", "status", "type"]);
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
        "Claude Code session/read response did not include supported session.status.type.",
      );
  }
}

function readActiveQueryId(value: unknown): string | null {
  return readNestedString(value, ["session", "activeQueryId"]);
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

  ClaudeCodeConnections.set(connection, rpcClient);
  return connection;
}

export function createClaudeCodeConversationProvider(): AgentConversationProvider {
  return {
    connect: connectClaudeCodeConversationProvider,
    createConversation: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(
        "session/create",
        {
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.options === undefined ? {} : { options: input.options }),
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerConversationId: extractSessionId(result, "session/create"),
      };
    },
    resumeConversation: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      await claudeCodeClient.call("session/resume", {
        sessionId: input.providerConversationId,
      });
    },
    inspectConversation: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call("session/read", {
        sessionId: input.providerConversationId,
      });
      return {
        exists: true,
        status: normalizeSessionStatus(result),
        activeExecutionId: readActiveQueryId(result),
      };
    },
    generateConversationTitle: async (input) => {
      const connection = await connectClaudeCodeConversationProvider({
        connectionUrl: input.connectionUrl,
      });
      try {
        const claudeCodeClient = getClaudeCodeClient(connection);
        const result = await claudeCodeClient.call("title/generate", {
          inputText: input.inputText,
          sessionId: input.providerConversationId,
        });
        return {
          title: extractGeneratedTitle(result),
        };
      } finally {
        await connection.close();
      }
    },
    startExecution: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(
        "query/start",
        {
          sessionId: input.providerConversationId,
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
        providerExecutionId: extractQueryId(result, "query/start"),
      };
    },
    steerExecution: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(
        "query/steer",
        {
          sessionId: input.providerConversationId,
          expectedQueryId: input.providerExecutionId,
          inputText: input.inputText,
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractQueryId(result, "query/steer"),
      };
    },
    submitAssociatedResourceDelivery: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(
        "query/start",
        {
          sessionId: input.providerConversationId,
          inputText: input.inputText,
        },
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractQueryId(result, "query/start"),
      };
    },
    interruptExecution: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      await claudeCodeClient.call("query/interrupt", {
        sessionId: input.providerConversationId,
        queryId: input.providerExecutionId,
      });
    },
  };
}
