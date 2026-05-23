import type {
  AgentConversationCollaborationModeSettings,
  AgentConversationConnection,
  AgentConversationIdempotencyMetadata,
  AgentConversationProvider,
  AgentConversationStatus,
} from "@mistle/integrations-core";
import { AgentConversationStatuses } from "@mistle/integrations-core";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { z } from "zod";

import {
  createOpenCodeSessionClient,
  type OpenCodeCreateSessionInput,
  type OpenCodeSendPromptInput,
  type OpenCodeSessionClient,
  type OpenCodeSessionStatus,
} from "./client.js";
import { waitForGeneratedOpenCodeConversationTitle } from "./title-generation.js";

const DeliveryContextNotificationMethod = "mistle/setDeliveryContext";
const OpenCodeProviderExecutionIdPrefix = "opencode-session";

const OpenCodeProviderStateSchema = z.object({
  previousConversationTitle: z.string(),
});

type OpenCodeProviderState = z.output<typeof OpenCodeProviderStateSchema>;

const OpenCodeDeliveryContextNotificationParamsSchema = z
  .object({
    source: z.enum(["webhook", "schedule"]),
    webhookEventId: z.string().optional(),
    scheduledActionId: z.string().optional(),
    deliveryTaskId: z.string(),
    externalDeliveryId: z.string().optional(),
    triggerRunId: z.string(),
    conversationId: z.string(),
    sandboxInstanceId: z.string(),
    routeId: z.string().optional(),
    traceparent: z.string(),
    tracestate: z.string().optional(),
    baggage: z.string().optional(),
  })
  .loose();

type OpenCodeDeliveryContextNotificationParams = z.output<
  typeof OpenCodeDeliveryContextNotificationParamsSchema
>;

const OpenCodeConnections = new WeakMap<
  AgentConversationConnection,
  {
    client: OpenCodeSessionClient;
    deliveryContextNotificationParams?: OpenCodeDeliveryContextNotificationParams;
    transport: SandboxSessionTransport;
  }
>();

function createUnsupportedOpenCodeProviderRequestError(method: string): Error {
  return new Error(
    `OpenCode conversation provider does not support generic request method '${method}'.`,
  );
}

function getOpenCodeConnection(connection: AgentConversationConnection): {
  client: OpenCodeSessionClient;
  deliveryContextNotificationParams?: OpenCodeDeliveryContextNotificationParams;
  transport: SandboxSessionTransport;
} {
  const openCodeConnection = OpenCodeConnections.get(connection);
  if (openCodeConnection === undefined) {
    throw new Error("OpenCode conversation provider received an unknown connection.");
  }

  return openCodeConnection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenCodeNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.status === 404 || error.statusCode === 404;
}

function resolveOpenCodeConversationStatus(
  status: OpenCodeSessionStatus | undefined,
): AgentConversationStatus {
  if (status?.type === "busy" || status?.type === "retry") {
    return AgentConversationStatuses.ACTIVE;
  }

  return AgentConversationStatuses.IDLE;
}

function createOpenCodeProviderState(input: { previousConversationTitle: string }) {
  return {
    previousConversationTitle: input.previousConversationTitle,
  } satisfies OpenCodeProviderState;
}

function readOpenCodeProviderState(providerState: unknown): OpenCodeProviderState {
  return OpenCodeProviderStateSchema.parse(providerState);
}

function createOpenCodeProviderExecutionId(providerConversationId: string): string {
  return `${OpenCodeProviderExecutionIdPrefix}:${providerConversationId}`;
}

function createOpenCodePromptInput(input: {
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  deliveryContextNotificationParams?: OpenCodeDeliveryContextNotificationParams | undefined;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
  inputText: string;
  providerConversationId: string;
}): OpenCodeSendPromptInput {
  const system = renderOpenCodePromptSystem({
    collaborationModeSettings: input.collaborationModeSettings,
    deliveryContextNotificationParams: input.deliveryContextNotificationParams,
  });

  return {
    sessionId: input.providerConversationId,
    parts: [
      {
        type: "text",
        text: input.inputText,
      },
    ],
    ...(system === undefined ? {} : { system }),
    ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
  };
}

export function renderOpenCodePromptSystem(input: {
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  deliveryContextNotificationParams?: OpenCodeDeliveryContextNotificationParams | undefined;
}): string | undefined {
  const sections: string[] = [];
  const developerInstructions = input.collaborationModeSettings?.developerInstructions;
  if (developerInstructions !== undefined && developerInstructions !== null) {
    sections.push(developerInstructions);
  }
  if (input.deliveryContextNotificationParams !== undefined) {
    sections.push(
      [
        "Mistle trigger delivery context:",
        JSON.stringify(input.deliveryContextNotificationParams, null, 2),
      ].join("\n"),
    );
  }

  return sections.length === 0 ? undefined : sections.join("\n\n");
}

async function connectOpenCodeConversationProvider(input: {
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

  const client = createOpenCodeSessionClient({
    transport,
  });

  const connection: AgentConversationConnection = {
    request: async (requestInput) => {
      throw createUnsupportedOpenCodeProviderRequestError(requestInput.method);
    },
    notify: async (notificationInput) => {
      if (notificationInput.method !== DeliveryContextNotificationMethod) {
        throw createUnsupportedOpenCodeProviderRequestError(notificationInput.method);
      }

      const openCodeConnection = getOpenCodeConnection(connection);
      openCodeConnection.deliveryContextNotificationParams =
        OpenCodeDeliveryContextNotificationParamsSchema.parse(notificationInput.params);
    },
    close: async () => {
      client.close();
      transport.disconnect(1000, "OpenCode conversation provider closed");
      OpenCodeConnections.delete(connection);
    },
  };

  OpenCodeConnections.set(connection, {
    client,
    transport,
  });

  return connection;
}

export function createOpenCodeConversationProvider(): AgentConversationProvider {
  return {
    connect: connectOpenCodeConversationProvider,
    inspectConversation: async (input) => {
      const { client } = getOpenCodeConnection(input.connection);
      try {
        await client.getSession({
          sessionId: input.providerConversationId,
        });
      } catch (error) {
        if (isOpenCodeNotFoundError(error)) {
          return {
            exists: false,
            status: AgentConversationStatuses.IDLE,
            activeExecutionId: null,
          };
        }

        throw error;
      }

      const sessionStatuses = await client.listSessionStatuses();
      const status = resolveOpenCodeConversationStatus(
        sessionStatuses[input.providerConversationId],
      );

      return {
        exists: true,
        status,
        activeExecutionId:
          status === AgentConversationStatuses.ACTIVE
            ? createOpenCodeProviderExecutionId(input.providerConversationId)
            : null,
      };
    },
    readConversationMetadata: async (input) => {
      const { client } = getOpenCodeConnection(input.connection);
      const session = await client.getSession({
        sessionId: input.providerConversationId,
      });

      return {
        name: session.title,
        preview: null,
      };
    },
    generateConversationTitle: async (input) => {
      const providerState = readOpenCodeProviderState(input.providerState);
      const connection = await connectOpenCodeConversationProvider({
        connectionUrl: input.connectionUrl,
      });
      try {
        const { client } = getOpenCodeConnection(connection);
        const title = await waitForGeneratedOpenCodeConversationTitle({
          previousTitle: providerState.previousConversationTitle,
          readCurrentTitle: async () => {
            const session = await client.getSession({
              sessionId: input.providerConversationId,
            });
            return session.title;
          },
        });

        return {
          title,
        };
      } finally {
        await connection.close();
      }
    },
    createConversation: async (input) => {
      const { client } = getOpenCodeConnection(input.connection);
      const createInput: OpenCodeCreateSessionInput = {};
      if (input.cwd !== undefined) {
        createInput.directory = input.cwd;
      }
      if (input.idempotency !== undefined) {
        createInput.idempotency = input.idempotency;
      }
      const session = await client.createSession(createInput);

      return {
        providerConversationId: session.id,
      };
    },
    resumeConversation: async (input) => {
      const { client } = getOpenCodeConnection(input.connection);
      await client.getSession({
        sessionId: input.providerConversationId,
      });
    },
    startExecution: async (input) => {
      const { client, deliveryContextNotificationParams } = getOpenCodeConnection(input.connection);
      const session = await client.getSession({
        sessionId: input.providerConversationId,
      });
      await client.sendPrompt(
        createOpenCodePromptInput({
          collaborationModeSettings: input.collaborationModeSettings,
          deliveryContextNotificationParams,
          idempotency: input.idempotency,
          inputText: input.inputText,
          providerConversationId: input.providerConversationId,
        }),
      );

      return {
        providerExecutionId: createOpenCodeProviderExecutionId(input.providerConversationId),
        providerState: createOpenCodeProviderState({
          previousConversationTitle: session.title,
        }),
      };
    },
    steerExecution: async (input) => {
      const { client, deliveryContextNotificationParams } = getOpenCodeConnection(input.connection);
      const session = await client.getSession({
        sessionId: input.providerConversationId,
      });
      await client.sendPrompt(
        createOpenCodePromptInput({
          deliveryContextNotificationParams,
          idempotency: input.idempotency,
          inputText: input.inputText,
          providerConversationId: input.providerConversationId,
        }),
      );

      return {
        providerExecutionId: input.providerExecutionId,
        providerState: createOpenCodeProviderState({
          previousConversationTitle: session.title,
        }),
      };
    },
    interruptExecution: async (input) => {
      const { client } = getOpenCodeConnection(input.connection);
      await client.abortSession({
        sessionId: input.providerConversationId,
      });
    },
  };
}
