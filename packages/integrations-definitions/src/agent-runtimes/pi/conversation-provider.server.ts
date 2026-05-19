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

import { createPiSessionClient, type PiSessionClient, type PiSessionState } from "./client.js";
import { generatePiConversationTitle } from "./title-generation.js";

const DeliveryContextNotificationMethod = "mistle/setDeliveryContext";
const PiProviderExecutionIdPrefix = "pi-session";

const PiDeliveryContextNotificationParamsSchema = z
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

type PiDeliveryContextNotificationParams = z.output<
  typeof PiDeliveryContextNotificationParamsSchema
>;

const PiConnections = new WeakMap<
  AgentConversationConnection,
  {
    client: PiSessionClient;
    deliveryContextNotificationParams?: PiDeliveryContextNotificationParams;
    transport: SandboxSessionTransport;
  }
>();

function createUnsupportedPiProviderRequestError(method: string): Error {
  return new Error(`Pi conversation provider does not support generic request method '${method}'.`);
}

function getPiConnection(connection: AgentConversationConnection): {
  client: PiSessionClient;
  deliveryContextNotificationParams?: PiDeliveryContextNotificationParams;
  transport: SandboxSessionTransport;
} {
  const piConnection = PiConnections.get(connection);
  if (piConnection === undefined) {
    throw new Error("Pi conversation provider received an unknown connection.");
  }

  return piConnection;
}

function createPiProviderExecutionId(providerConversationId: string): string {
  return `${PiProviderExecutionIdPrefix}:${providerConversationId}`;
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
        "Mistle trigger delivery context:",
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
    transport,
  });

  return connection;
}

export function createPiConversationProvider(): AgentConversationProvider {
  return {
    connect: connectPiConversationProvider,
    inspectConversation: async (input) => {
      const { client } = getPiConnection(input.connection);
      const state = await client.getState({
        sessionFile: input.providerConversationId,
      });
      const status = resolvePiConversationStatus(state);

      return {
        exists: state.sessionFile === input.providerConversationId,
        status,
        activeExecutionId:
          status === AgentConversationStatuses.ACTIVE
            ? createPiProviderExecutionId(input.providerConversationId)
            : null,
      };
    },
    readConversationMetadata: async (input) => {
      const { client } = getPiConnection(input.connection);
      return client.readMetadata({
        sessionFile: input.providerConversationId,
      });
    },
    generateConversationTitle: generatePiConversationTitle,
    createConversation: async (input) => {
      const { client } = getPiConnection(input.connection);
      return input.cwd === undefined
        ? client.createConversation({})
        : client.createConversation({ cwd: input.cwd });
    },
    resumeConversation: async (input) => {
      const { client } = getPiConnection(input.connection);
      await client.resumeConversation({
        sessionFile: input.providerConversationId,
      });
    },
    startExecution: async (input) => {
      const { client, deliveryContextNotificationParams } = getPiConnection(input.connection);
      await client.prompt({
        sessionFile: input.providerConversationId,
        message: renderPiPromptInput({
          collaborationModeSettings: input.collaborationModeSettings,
          deliveryContextNotificationParams,
          inputText: input.inputText,
        }),
      });

      return {
        providerExecutionId: createPiProviderExecutionId(input.providerConversationId),
      };
    },
    steerExecution: async (input) => {
      const { client, deliveryContextNotificationParams } = getPiConnection(input.connection);
      await client.steer({
        sessionFile: input.providerConversationId,
        message: renderPiPromptInput({
          deliveryContextNotificationParams,
          inputText: input.inputText,
        }),
      });

      return {
        providerExecutionId: input.providerExecutionId,
      };
    },
    recoverLateSteer: async (input) => {
      const { client, deliveryContextNotificationParams } = getPiConnection(input.connection);
      const state = await client.getState({
        sessionFile: input.providerConversationId,
      });
      const message = renderPiPromptInput({
        deliveryContextNotificationParams,
        inputText: input.inputText,
      });

      if (resolvePiConversationStatus(state) === AgentConversationStatuses.ACTIVE) {
        await client.steer({
          sessionFile: input.providerConversationId,
          message,
        });

        return {
          providerExecutionId: input.providerExecutionId,
        };
      }

      await client.followUp({
        sessionFile: input.providerConversationId,
        message,
      });

      return {
        providerExecutionId: createPiProviderExecutionId(input.providerConversationId),
      };
    },
    interruptExecution: async (input) => {
      const { client } = getPiConnection(input.connection);
      await client.abort({
        sessionFile: input.providerConversationId,
      });
    },
  };
}
