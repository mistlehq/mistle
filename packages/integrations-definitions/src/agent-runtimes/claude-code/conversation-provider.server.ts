import type {
  AgentConversationCollaborationModeSettings,
  AgentConversationConnection,
  AgentConversationInspectResult,
  AgentConversationProvider,
} from "@mistle/integrations-core";
import { AgentConversationStatuses } from "@mistle/integrations-core";
import { AgentStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";

import { ClaudeCodeJsonRpcClient } from "./json-rpc-client.js";
import {
  ClaudeCodeRuntimeMethods,
  extractClaudeCodeQueryId,
  extractClaudeCodeSessionId,
  readClaudeCodeNestedString,
} from "./protocol.js";

const ClaudeCodeConnections = new WeakMap<AgentConversationConnection, ClaudeCodeJsonRpcClient>();

function getClaudeCodeClient(connection: AgentConversationConnection): ClaudeCodeJsonRpcClient {
  const claudeCodeClient = ClaudeCodeConnections.get(connection);
  if (claudeCodeClient === undefined) {
    throw new Error("Claude Code conversation provider received an unknown connection.");
  }
  return claudeCodeClient;
}

function normalizeSessionStatus(value: unknown): AgentConversationInspectResult["status"] {
  const statusType = readClaudeCodeNestedString(value, ["session", "status", "type"]);
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
  return readClaudeCodeNestedString(value, ["session", "activeQueryId"]);
}

function extractGeneratedTitle(result: unknown): string {
  const title = readClaudeCodeNestedString(result, ["title"]);
  if (title === null) {
    throw new Error("Claude Code title/generate response did not include title.");
  }
  return title;
}

export function buildClaudeCodeCreateSessionParams(input: {
  cwd?: string | undefined;
  options?: Readonly<Record<string, unknown>> | undefined;
}): Record<string, unknown> {
  return input.cwd === undefined ? {} : { cwd: input.cwd };
}

export function buildClaudeCodeStartQueryParams(input: {
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  inputText: string;
  providerConversationId: string;
}): Record<string, unknown> {
  return {
    sessionId: input.providerConversationId,
    inputText: input.inputText,
  };
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
        ClaudeCodeRuntimeMethods.SESSION_CREATE,
        buildClaudeCodeCreateSessionParams({
          cwd: input.cwd,
          options: input.options,
        }),
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerConversationId: extractClaudeCodeSessionId(
          result,
          ClaudeCodeRuntimeMethods.SESSION_CREATE,
        ),
      };
    },
    resumeConversation: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      await claudeCodeClient.call(ClaudeCodeRuntimeMethods.SESSION_RESUME, {
        sessionId: input.providerConversationId,
      });
    },
    inspectConversation: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(ClaudeCodeRuntimeMethods.SESSION_READ, {
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
        const result = await claudeCodeClient.call(ClaudeCodeRuntimeMethods.TITLE_GENERATE, {
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
        ClaudeCodeRuntimeMethods.QUERY_START,
        buildClaudeCodeStartQueryParams({
          collaborationModeSettings: input.collaborationModeSettings,
          providerConversationId: input.providerConversationId,
          inputText: input.inputText,
        }),
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractClaudeCodeQueryId(result, ClaudeCodeRuntimeMethods.QUERY_START),
      };
    },
    steerExecution: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(
        ClaudeCodeRuntimeMethods.QUERY_STEER,
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
        providerExecutionId: extractClaudeCodeQueryId(result, ClaudeCodeRuntimeMethods.QUERY_STEER),
      };
    },
    submitAssociatedResourceDelivery: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      const result = await claudeCodeClient.call(
        ClaudeCodeRuntimeMethods.QUERY_START,
        buildClaudeCodeStartQueryParams({
          providerConversationId: input.providerConversationId,
          inputText: input.inputText,
        }),
        {
          idempotency: input.idempotency,
        },
      );
      return {
        providerExecutionId: extractClaudeCodeQueryId(result, ClaudeCodeRuntimeMethods.QUERY_START),
      };
    },
    interruptExecution: async (input) => {
      const claudeCodeClient = getClaudeCodeClient(input.connection);
      await claudeCodeClient.call(ClaudeCodeRuntimeMethods.QUERY_INTERRUPT, {
        sessionId: input.providerConversationId,
        queryId: input.providerExecutionId,
      });
    },
  };
}
