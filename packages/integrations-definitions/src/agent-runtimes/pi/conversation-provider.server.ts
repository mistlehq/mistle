import type {
  AgentConversationCollaborationModeSettings,
  AgentConversationConnection,
  AgentConversationProvider,
  AgentConversationStatus,
} from "@mistle/integrations-core";
import { AgentConversationStatuses } from "@mistle/integrations-core";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { z } from "zod";

import {
  createPiSessionClient,
  type PiConversationSummary,
  type PiSessionClient,
  type PiSessionState,
} from "./client.js";
import { generatePiConversationTitle } from "./title-generation.js";

const DeliveryContextNotificationMethod = "mistle/setDeliveryContext";
const PiProviderExecutionIdPrefix = "pi-session";
const PiOriginalConversationInitialLimit = 100;

const PiDeliveryTraceContextSchema = z
  .object({
    traceparent: z.string(),
    tracestate: z.string().optional(),
    baggage: z.string().optional(),
  })
  .loose();

const PiDeliveryContextNotificationParamsSchema = z.discriminatedUnion("source", [
  PiDeliveryTraceContextSchema.extend({
    source: z.literal("webhook"),
    webhookEventId: z.string().optional(),
    deliveryTaskId: z.string(),
    externalDeliveryId: z.string().optional(),
    triggerRunId: z.string(),
    conversationId: z.string(),
    sandboxInstanceId: z.string(),
    routeId: z.string().optional(),
  }),
  PiDeliveryTraceContextSchema.extend({
    source: z.literal("schedule"),
    scheduledActionId: z.string().optional(),
    deliveryTaskId: z.string(),
    externalDeliveryId: z.string().optional(),
    triggerRunId: z.string(),
    conversationId: z.string(),
    sandboxInstanceId: z.string(),
    routeId: z.string().optional(),
  }),
  PiDeliveryTraceContextSchema.extend({
    source: z.literal("association"),
    providerResourceAssociationId: z.string(),
    associationDeliveryId: z.string(),
    webhookEventId: z.string(),
    externalDeliveryId: z.string().optional(),
    sandboxInstanceId: z.string(),
  }),
]);

type PiDeliveryContextNotificationParams = z.output<
  typeof PiDeliveryContextNotificationParamsSchema
>;

type PiConnection = {
  client: PiSessionClient;
  deliveryContextNotificationParams?: PiDeliveryContextNotificationParams;
  sessionFilesByConversationId: Map<string, string>;
};

const PiConnections = new WeakMap<AgentConversationConnection, PiConnection>();

function createUnsupportedPiProviderRequestError(method: string): Error {
  return new Error(`Pi conversation provider does not support generic request method '${method}'.`);
}

function getPiConnection(connection: AgentConversationConnection): PiConnection {
  const piConnection = PiConnections.get(connection);
  if (piConnection === undefined) {
    throw new Error("Pi conversation provider received an unknown connection.");
  }

  return piConnection;
}

async function resolvePiSessionFile(input: {
  piConnection: PiConnection;
  providerConversationId: string;
}): Promise<string> {
  const cachedSessionFile = input.piConnection.sessionFilesByConversationId.get(
    input.providerConversationId,
  );
  if (cachedSessionFile !== undefined) {
    return cachedSessionFile;
  }

  const resolvedConversation = await input.piConnection.client.resolveConversation({
    providerConversationId: input.providerConversationId,
  });
  input.piConnection.sessionFilesByConversationId.set(
    input.providerConversationId,
    resolvedConversation.sessionFile,
  );
  return resolvedConversation.sessionFile;
}

function createPiProviderExecutionId(providerConversationId: string): string {
  return `${PiProviderExecutionIdPrefix}:${providerConversationId}`;
}

function parsePiConversationCreatedAt(conversation: PiConversationSummary): number | null {
  if (conversation.createdAt === null) {
    return null;
  }

  const createdAt = Date.parse(conversation.createdAt);
  return Number.isNaN(createdAt) ? null : createdAt;
}

export function resolveOriginalPiConversationId(
  conversations: readonly PiConversationSummary[],
): string | null {
  let originalConversationId: string | null = null;
  let originalCreatedAt: number | null = null;

  for (const conversation of conversations) {
    const createdAt = parsePiConversationCreatedAt(conversation);
    if (createdAt === null) {
      continue;
    }

    if (
      originalCreatedAt === null ||
      createdAt < originalCreatedAt ||
      (createdAt === originalCreatedAt &&
        (originalConversationId === null || conversation.id < originalConversationId))
    ) {
      originalConversationId = conversation.id;
      originalCreatedAt = createdAt;
    }
  }

  return originalConversationId;
}

async function listAllPiConversations(input: {
  client: PiSessionClient;
}): Promise<readonly PiConversationSummary[]> {
  let limit = PiOriginalConversationInitialLimit;

  while (true) {
    const page = await input.client.listConversations({
      limit,
    });
    if (!page.hasMore) {
      return page.conversations;
    }

    limit *= 2;
  }
}

function resolvePiConversationStatus(state: PiSessionState): AgentConversationStatus {
  return state.isStreaming || state.isCompacting || state.pendingMessageCount > 0
    ? AgentConversationStatuses.ACTIVE
    : AgentConversationStatuses.IDLE;
}

function renderPiPromptInput(input: {
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  deliveryContextNotificationParams?: PiDeliveryContextNotificationParams | undefined;
  inputText: string;
}): string {
  const sections: string[] = [];
  const developerInstructions = input.collaborationModeSettings?.developerInstructions;
  if (developerInstructions !== undefined && developerInstructions !== null) {
    sections.push(developerInstructions);
  }
  if (input.deliveryContextNotificationParams !== undefined) {
    sections.push(
      [
        "Mistle delivery context:",
        JSON.stringify(input.deliveryContextNotificationParams, null, 2),
      ].join("\n"),
    );
  }
  sections.push(input.inputText);

  return sections.join("\n\n");
}

async function connectPiConversationProvider(input: {
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

  const client = createPiSessionClient({
    transport,
  });
  await client.connect();

  const connection: AgentConversationConnection = {
    request: async (requestInput) => {
      throw createUnsupportedPiProviderRequestError(requestInput.method);
    },
    notify: async (notificationInput) => {
      if (notificationInput.method !== DeliveryContextNotificationMethod) {
        throw createUnsupportedPiProviderRequestError(notificationInput.method);
      }

      const piConnection = getPiConnection(connection);
      piConnection.deliveryContextNotificationParams =
        PiDeliveryContextNotificationParamsSchema.parse(notificationInput.params);
    },
    close: async () => {
      client.close();
      transport.disconnect(1000, "Pi conversation provider closed");
      PiConnections.delete(connection);
    },
  };

  PiConnections.set(connection, {
    client,
    sessionFilesByConversationId: new Map(),
  });

  return connection;
}

export function createPiConversationProvider(): AgentConversationProvider {
  return {
    connect: connectPiConversationProvider,
    inspectConversation: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const sessionFile = await resolvePiSessionFile({
        piConnection,
        providerConversationId: input.providerConversationId,
      });
      const state = await piConnection.client.getState({
        sessionFile,
      });
      const status = resolvePiConversationStatus(state);

      return {
        exists: state.sessionFile === sessionFile,
        status,
        activeExecutionId:
          status === AgentConversationStatuses.ACTIVE
            ? createPiProviderExecutionId(input.providerConversationId)
            : null,
      };
    },
    readConversationMetadata: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const sessionFile = await resolvePiSessionFile({
        piConnection,
        providerConversationId: input.providerConversationId,
      });
      return piConnection.client.readMetadata({
        sessionFile,
      });
    },
    generateConversationTitle: generatePiConversationTitle,
    resolveOriginalConversation: async (input) => {
      if (
        input.explicitProviderConversationId !== undefined &&
        input.explicitProviderConversationId !== null
      ) {
        return {
          providerConversationId: input.explicitProviderConversationId,
        };
      }

      const piConnection = getPiConnection(input.connection);
      return {
        providerConversationId: resolveOriginalPiConversationId(
          await listAllPiConversations({
            client: piConnection.client,
          }),
        ),
      };
    },
    createConversation: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const createInput =
        input.cwd === undefined
          ? input.idempotency === undefined
            ? {}
            : { idempotency: input.idempotency }
          : input.idempotency === undefined
            ? { cwd: input.cwd }
            : { cwd: input.cwd, idempotency: input.idempotency };
      const createdConversation = await piConnection.client.createConversation(createInput);
      piConnection.sessionFilesByConversationId.set(
        createdConversation.providerConversationId,
        createdConversation.sessionFile,
      );
      return createdConversation;
    },
    resumeConversation: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const resumedConversation = await piConnection.client.resumeConversation({
        providerConversationId: input.providerConversationId,
      });
      piConnection.sessionFilesByConversationId.set(
        input.providerConversationId,
        resumedConversation.sessionFile,
      );
    },
    startExecution: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const sessionFile = await resolvePiSessionFile({
        piConnection,
        providerConversationId: input.providerConversationId,
      });
      await piConnection.client.prompt({
        sessionFile,
        message: renderPiPromptInput({
          collaborationModeSettings: input.collaborationModeSettings,
          deliveryContextNotificationParams: piConnection.deliveryContextNotificationParams,
          inputText: input.inputText,
        }),
        ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
      });

      return {
        providerExecutionId: createPiProviderExecutionId(input.providerConversationId),
      };
    },
    steerExecution: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const sessionFile = await resolvePiSessionFile({
        piConnection,
        providerConversationId: input.providerConversationId,
      });
      await piConnection.client.steer({
        sessionFile,
        message: renderPiPromptInput({
          deliveryContextNotificationParams: piConnection.deliveryContextNotificationParams,
          inputText: input.inputText,
        }),
        ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
      });

      return {
        providerExecutionId: input.providerExecutionId,
      };
    },
    recoverLateSteer: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const sessionFile = await resolvePiSessionFile({
        piConnection,
        providerConversationId: input.providerConversationId,
      });
      const state = await piConnection.client.getState({
        sessionFile,
      });
      const message = renderPiPromptInput({
        deliveryContextNotificationParams: piConnection.deliveryContextNotificationParams,
        inputText: input.inputText,
      });

      if (resolvePiConversationStatus(state) === AgentConversationStatuses.ACTIVE) {
        await piConnection.client.steer({
          sessionFile,
          message,
          ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
        });

        return {
          providerExecutionId: input.providerExecutionId,
        };
      }

      await piConnection.client.followUp({
        sessionFile,
        message,
        ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
      });

      return {
        providerExecutionId: createPiProviderExecutionId(input.providerConversationId),
      };
    },
    interruptExecution: async (input) => {
      const piConnection = getPiConnection(input.connection);
      const sessionFile = await resolvePiSessionFile({
        piConnection,
        providerConversationId: input.providerConversationId,
      });
      await piConnection.client.abort({
        sessionFile,
      });
    },
  };
}
