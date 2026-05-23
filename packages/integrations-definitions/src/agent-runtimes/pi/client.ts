import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { AgentStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { z } from "zod";

const PiModelSchema = z.looseObject({
  id: z.string(),
  input: z.array(z.string()),
  name: z.string(),
  provider: z.string(),
  reasoning: z.boolean(),
  thinkingLevelMap: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
});

const PiThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

const PiSessionStateSchema = z.looseObject({
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  model: PiModelSchema.nullable(),
  thinkingLevel: PiThinkingLevelSchema,
  sessionFile: z.string().optional(),
  sessionId: z.string(),
  sessionName: z.string().optional(),
  messageCount: z.number(),
  pendingMessageCount: z.number(),
});

const PiAgentMessageSchema = z.looseObject({
  role: z.string(),
  content: z.unknown().optional(),
  timestamp: z.number().optional(),
});

const PiAvailableModelsResultSchema = z.object({
  models: z.array(PiModelSchema),
});

const PiAgentMessagesResultSchema = z.object({
  messages: z.array(PiAgentMessageSchema),
});

const PiEventSchema = z.looseObject({
  type: z.string(),
});

const PiProviderConversationResultSchema = z.object({
  providerConversationId: z.string(),
  sessionFile: z.string(),
});

const PiRecentConversationResultSchema = z.object({
  providerConversationId: z.string().nullable(),
});

const PiConversationSummarySchema = z.object({
  id: z.string(),
  sessionFile: z.string(),
  cwd: z.string(),
  title: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.number().nullable(),
});

const PiSessionFileResultSchema = z.object({
  sessionFile: z.string(),
});

const PiListConversationsResultSchema = z.object({
  conversations: z.array(PiConversationSummarySchema),
  hasMore: z.boolean(),
});

const PiReadMetadataResultSchema = z.object({
  name: z.string().nullable(),
  preview: z.string().nullable(),
});

export type PiSessionState = z.output<typeof PiSessionStateSchema>;
export type PiModel = z.output<typeof PiModelSchema>;
export type PiThinkingLevel = z.output<typeof PiThinkingLevelSchema>;
export type PiAgentMessage = z.output<typeof PiAgentMessageSchema>;
export type PiEvent = z.output<typeof PiEventSchema>;
export type PiConversationSummary = z.output<typeof PiConversationSummarySchema>;
export type PiListConversationsResult = z.output<typeof PiListConversationsResultSchema>;

export function parsePiSessionState(input: unknown): PiSessionState {
  return PiSessionStateSchema.parse(input);
}

export type PiEventSubscription = {
  close(): void;
};

export type PiSessionClient = {
  close(): void;
  connect(): Promise<void>;
  createConversation(input: {
    cwd?: string;
    idempotency?: AgentConversationIdempotencyMetadata;
  }): Promise<{
    providerConversationId: string;
    sessionFile: string;
  }>;
  findRecentConversation(input?: { cwd?: string | null }): Promise<{
    providerConversationId: string | null;
  }>;
  listConversations(input: {
    cwd?: string | null;
    limit: number;
  }): Promise<PiListConversationsResult>;
  getAvailableModels(input: { sessionFile: string }): Promise<readonly PiModel[]>;
  getState(input?: { sessionFile?: string }): Promise<PiSessionState>;
  getMessages(input: { sessionFile: string }): Promise<readonly PiAgentMessage[]>;
  readMetadata(input: {
    sessionFile: string;
  }): Promise<{ name: string | null; preview: string | null }>;
  resolveConversation(input: { providerConversationId: string }): Promise<{ sessionFile: string }>;
  resumeConversation(input: { providerConversationId: string }): Promise<{ sessionFile: string }>;
  setModel(input: { modelId: string; provider: string; sessionFile: string }): Promise<void>;
  setThinkingLevel(input: { level: PiThinkingLevel; sessionFile: string }): Promise<void>;
  setSessionName(input: { name: string; sessionFile: string }): Promise<void>;
  prompt(input: {
    message: string;
    sessionFile: string;
    idempotency?: AgentConversationIdempotencyMetadata;
  }): Promise<void>;
  steer(input: {
    message: string;
    sessionFile: string;
    idempotency?: AgentConversationIdempotencyMetadata;
  }): Promise<void>;
  followUp(input: {
    message: string;
    sessionFile: string;
    idempotency?: AgentConversationIdempotencyMetadata;
  }): Promise<void>;
  abort(input: { sessionFile: string }): Promise<void>;
  subscribeEvents(input: { onEvent: (event: PiEvent) => void }): PiEventSubscription;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type PiSessionClientInput = {
  transport: SandboxSessionTransport;
};

function isJsonRpcErrorResponse(
  response: unknown,
): response is { error: { code: number; message: string; data?: unknown } } {
  const parsed = z
    .object({
      error: z.object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      }),
    })
    .safeParse(response);
  return parsed.success;
}

export function createPiSessionClient(input: PiSessionClientInput): PiSessionClient {
  const agentStream = new AgentStreamClient({
    transport: input.transport,
  });
  const pendingRequests = new Map<string | number, PendingRequest>();
  const eventListeners = new Set<(event: PiEvent) => void>();
  let nextRequestId = 1;
  const unsubscribe = agentStream.onEvent((event) => {
    if (event.type === "connection_state_changed" && event.state === "closed") {
      rejectPending(event.errorMessage ?? "Pi agent stream closed.");
      return;
    }
    if (event.type === "stream_reset") {
      rejectPending(event.resetInfo.message);
      return;
    }
    if (event.type !== "response") {
      if (event.type === "notification" && event.notification.method === "pi/event") {
        const parsedEvent = PiEventSchema.safeParse(event.notification.params);
        if (!parsedEvent.success) {
          return;
        }
        for (const listener of eventListeners) {
          listener(parsedEvent.data);
        }
      }
      return;
    }

    const pending = pendingRequests.get(event.response.id);
    if (pending === undefined) {
      return;
    }

    pendingRequests.delete(event.response.id);
    if (isJsonRpcErrorResponse(event.response)) {
      pending.reject(new Error(event.response.error.message));
      return;
    }

    pending.resolve(event.response.result);
  });

  async function request(input: {
    method: string;
    params?: unknown;
    idempotency?: AgentConversationIdempotencyMetadata | undefined;
  }): Promise<unknown> {
    const id = `pi_${String(nextRequestId)}`;
    nextRequestId += 1;
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
    });
    try {
      await agentStream.sendJson({
        jsonrpc: "2.0",
        id,
        method: input.method,
        ...(input.params === undefined ? {} : { params: input.params }),
        ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
      });
    } catch (error) {
      pendingRequests.delete(id);
      throw error;
    }
    return responsePromise;
  }

  function rejectPending(message: string): void {
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error(message));
    }
    pendingRequests.clear();
  }

  return {
    async connect() {
      await agentStream.connect();
    },
    close() {
      unsubscribe();
      eventListeners.clear();
      rejectPending("Pi session client closed.");
      agentStream.dispose();
    },
    async createConversation(createInput) {
      const result = await request({
        method: "pi/createConversation",
        params: createInput.idempotency === undefined ? createInput : { cwd: createInput.cwd },
        idempotency: createInput.idempotency,
      });
      const created = PiProviderConversationResultSchema.parse(result);
      return {
        providerConversationId: created.providerConversationId,
        sessionFile: created.sessionFile,
      };
    },
    async findRecentConversation(findInput = {}) {
      const result = await request({
        method: "pi/findRecentConversation",
        params: findInput,
      });
      const recent = PiRecentConversationResultSchema.parse(result);
      return {
        providerConversationId: recent.providerConversationId,
      };
    },
    async listConversations(listInput) {
      const result = await request({
        method: "pi/listConversations",
        params: listInput,
      });
      return PiListConversationsResultSchema.parse(result);
    },
    async getState(getStateInput = {}) {
      const result = await request({
        method: "pi/getState",
        params: getStateInput,
      });
      return parsePiSessionState(result);
    },
    async getAvailableModels(getAvailableModelsInput) {
      const result = await request({
        method: "pi/getAvailableModels",
        params: getAvailableModelsInput,
      });
      return PiAvailableModelsResultSchema.parse(result).models;
    },
    async getMessages(getMessagesInput) {
      const result = await request({
        method: "pi/getMessages",
        params: getMessagesInput,
      });
      return PiAgentMessagesResultSchema.parse(result).messages;
    },
    async readMetadata(readMetadataInput) {
      const result = await request({
        method: "pi/readMetadata",
        params: readMetadataInput,
      });
      return PiReadMetadataResultSchema.parse(result);
    },
    async resolveConversation(resolveInput) {
      const result = await request({
        method: "pi/resolveConversation",
        params: resolveInput,
      });
      return PiSessionFileResultSchema.parse(result);
    },
    async resumeConversation(resumeInput) {
      const result = await request({
        method: "pi/resumeConversation",
        params: resumeInput,
      });
      return PiSessionFileResultSchema.parse(result);
    },
    async setModel(setModelInput) {
      await request({
        method: "pi/setModel",
        params: setModelInput,
      });
    },
    async setThinkingLevel(setThinkingLevelInput) {
      await request({
        method: "pi/setThinkingLevel",
        params: setThinkingLevelInput,
      });
    },
    async setSessionName(setSessionNameInput) {
      await request({
        method: "pi/setSessionName",
        params: setSessionNameInput,
      });
    },
    async prompt(promptInput) {
      await request({
        method: "pi/prompt",
        params: {
          sessionFile: promptInput.sessionFile,
          message: promptInput.message,
        },
        idempotency: promptInput.idempotency,
      });
    },
    async steer(steerInput) {
      await request({
        method: "pi/steer",
        params: {
          sessionFile: steerInput.sessionFile,
          message: steerInput.message,
        },
        idempotency: steerInput.idempotency,
      });
    },
    async followUp(followUpInput) {
      await request({
        method: "pi/followUp",
        params: {
          sessionFile: followUpInput.sessionFile,
          message: followUpInput.message,
        },
        idempotency: followUpInput.idempotency,
      });
    },
    async abort(abortInput) {
      await request({
        method: "pi/abort",
        params: abortInput,
      });
    },
    subscribeEvents(subscribeInput) {
      eventListeners.add(subscribeInput.onEvent);
      return {
        close() {
          eventListeners.delete(subscribeInput.onEvent);
        },
      };
    },
  };
}
